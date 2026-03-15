// background.js - MV3 service worker
import { storage } from "./storage.js";

const IS_DEBUG = false;
const BACKEND_BASE = IS_DEBUG ? "http://127.0.0.1:8200" : "http://62.234.168.105:8200";
const LLM_PROXY_URL = `${BACKEND_BASE}/api/llm-proxy`;
const CONTEXT_MENU_HIDE_SITE = "resume_quickfill_hide_site";
const CONTEXT_MENU_REPORT    = "resume_quickfill_report_issue";

// 内存缓存，存储最新的 resume 数据
let _resumeCache = null;

function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal })
    .catch(err => {
      if (err.name === 'AbortError') {
        throw new Error(`请求超时 (${timeoutMs}ms)`);
      }
      throw err;
    })
    .finally(() => clearTimeout(tid));
}

async function callLLMProxy(messages, { temperature=0.1, maxTokens=2048, jsonMode=true }={}, timeoutMs=120000) {
  const body = { messages, temperature, max_tokens: maxTokens };
  if (jsonMode) body.response_format = { type: "json_object" };
  const resp = await fetchWithTimeout(LLM_PROXY_URL, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  }, timeoutMs);
  if (!resp.ok) {
    const e = await resp.text().catch(() => "");
    throw new Error(`LLM proxy ${resp.status}: ${e.slice(0,200)}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM empty response");
  return content.trim();
}

async function parseViaBackend(fileName, fileData) {
  const binary = atob(fileData);
  const bytes = new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  const form = new FormData();
  form.append("file", new Blob([bytes]), fileName);
  const resp = await fetchWithTimeout(`${BACKEND_BASE}/parse-resume`, { method:"POST", body:form }, 90000);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text().catch(()=>"")).slice(0,200)}`);
  return await resp.json();
}

async function extractDocxText(bytes) {
  const str = new TextDecoder("utf-8",{fatal:false}).decode(bytes);
  const direct = [...str.matchAll(/<w:t(?:[^>])*>([^<]+)<\/w:t>/g)].map(m=>m[1]).join(" ");
  if (direct.length>20) return direct;
  try {
    let i=0;
    while (i<bytes.length-30) {
      if (bytes[i]===0x50&&bytes[i+1]===0x4B&&bytes[i+2]===0x03&&bytes[i+3]===0x04) {
        const comp=bytes[i+8]|(bytes[i+9]<<8), cSz=bytes[i+18]|(bytes[i+19]<<8)|(bytes[i+20]<<16)|(bytes[i+21]<<24);
        const nLen=bytes[i+26]|(bytes[i+27]<<8), eLen=bytes[i+28]|(bytes[i+29]<<8), dSt=i+30+nLen+eLen;
        const name=new TextDecoder().decode(bytes.slice(i+30,i+30+nLen));
        if (name==="word/document.xml") {
          const cd=bytes.slice(dSt,dSt+cSz); let xml="";
          if (comp===0) xml=new TextDecoder("utf-8",{fatal:false}).decode(cd);
          else if (comp===8) {
            const ds=new DecompressionStream("deflate-raw"); const w=ds.writable.getWriter();
            w.write(cd); w.close();
            xml=new TextDecoder("utf-8",{fatal:false}).decode(await new Response(ds.readable).arrayBuffer());
          }
          if (xml) return [...xml.matchAll(/<w:t(?:[^>])*>([^<]+)<\/w:t>/g)].map(m=>m[1]).join(" ");
          break;
        }
        i=dSt+cSz;
      } else i++;
    }
  } catch(e) { console.warn("DOCX parse:",e); }
  return "";
}

async function extractPdfText(bytes) {
  let text="";
  try {
    const utf8=new TextDecoder("utf-8",{fatal:false}).decode(bytes);
    for (const bm of [...utf8.matchAll(/BT[\s\S]{1,2000}?ET/g)]) {
      for (const m of bm[0].matchAll(/\(([^\\)]{1,200})\)\s*Tj/g)) text+=m[1]+" ";
      for (const m of bm[0].matchAll(/\[([^\]]{1,500})\]\s*TJ/g)) { for (const s of m[1].matchAll(/\(([^\\)]{1,200})\)/g)) text+=s[1]; text+=" "; }
    }
    text=text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"").trim();
    if (text.length>50) return text;
  } catch(e) {}
  text="";
  try {
    const latin=new TextDecoder("latin1").decode(bytes);
    for (const bm of [...latin.matchAll(/BT[\s\S]{1,3000}?ET/g)]) {
      for (const m of bm[0].matchAll(/\(([^()\\\x00-\x08\x0b\x0c\x0e-\x1f]{1,300})\)\s*Tj/g)) text+=m[1]+" ";
      for (const m of bm[0].matchAll(/\[([^\]]{1,500})\]\s*TJ/g)) { for (const s of m[1].matchAll(/\(([^()\\\x00-\x08]{1,200})\)/g)) text+=s[1]; text+=" "; }
    }
    if (text.length<50) for (const m of latin.matchAll(/stream([\s\S]{1,30000}?)endstream/g))
      for (const t of m[1].matchAll(/\(([^()\\\x00-\x08]{1,200})\)/g)) { const s=t[1].replace(/[\x00-\x1f]/g,"").trim(); if(s.length>1) text+=s+" "; }
    text=text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"").trim();
    if (text.length>50) return text;
  } catch(e) {}
  text="";
  try {
    const latin=new TextDecoder("latin1").decode(bytes);
    for (const sm of latin.matchAll(/FlateDecode[^\n]*\n?stream\r?\n([\s\S]{1,200000}?)\r?\nendstream/g)) {
      try {
        const raw=sm[1]; const rb=new Uint8Array(raw.length);
        for (let i=0;i<raw.length;i++) rb[i]=raw.charCodeAt(i)&0xff;
        const ds=new DecompressionStream("deflate"); const wr=ds.writable.getWriter(); wr.write(rb); wr.close();
        const dec=new TextDecoder("utf-8",{fatal:false}).decode(await new Response(ds.readable).arrayBuffer());
        for (const bm of dec.matchAll(/BT[\s\S]{1,3000}?ET/g)) {
          for (const m of bm[0].matchAll(/\(([^()\\]{1,300})\)\s*Tj/g)) text+=m[1]+" ";
          for (const m of bm[0].matchAll(/\[([^\]]{1,500})\]\s*TJ/g)) { for (const s of m[1].matchAll(/\(([^()\\]{1,200})\)/g)) text+=s[1]; text+=" "; }
        }
        if (text.length<50) for (const m of dec.matchAll(/\(([^()\\\x00-\x1f]{2,200})\)/g)) text+=m[1]+" ";
      } catch(e) {}
    }
    text=text.replace(/[\x00-\x1f]/g," ").replace(/\s+/g," ").trim();
    if (text.length>50) return text;
  } catch(e) {}
  try {
    const u=new TextDecoder("utf-8",{fatal:false}).decode(bytes);
    text=[...u.matchAll(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]{2}|[a-zA-Z0-9@.\-_+\s]{4}/g)].map(m=>m[0]).join(" ").replace(/\s+/g," ").trim();
  } catch(e) {}
  return text.trim();
}

function safeParseJson(raw) {
  try { return JSON.parse(raw); } catch(e) {}
  let c=raw.trim();
  if (c.startsWith('```')) c=c.split('\n').slice(1).join('\n').replace(/```\s*$/,'').trim();
  try { return JSON.parse(c); } catch(e) {}
  const s=c.indexOf('{'),e2=c.lastIndexOf('}');
  if (s!==-1&&e2>s) try { return JSON.parse(c.slice(s,e2+1)); } catch(e) {}
  throw new Error('Cannot parse LLM JSON: '+raw.slice(0,100));
}

async function callLLM(resumeText, retries=2) {
  const sys="You are a resume parser. Output strict JSON only. Fields:"+JSON.stringify({
    full_name:"",phone:"",email:"",gender:"",birth_date:"",location:"",target_city:"",expected_salary:"",
    self_intro:"",github:"",website:"",
    education:[{school:"",degree:"",major:"",start_date:"",end_date:""}],
    work_experience:[{company:"",position:"",start_date:"",end_date:"",description:""}],
    projects:[{name:"",role:"",description:"",start_date:"",end_date:""}],
    skills:[],languages:[{language:"",proficiency:""}],certificates:[{name:"",date:""}]
  });
  const txt=resumeText.length>8000?resumeText.slice(0,8000):resumeText;
  let lastErr;
  for (let i=0;i<=retries;i++) {
    try {
      if(i>0) await new Promise(r=>setTimeout(r,1000*i));
      const content=await callLLMProxy([{role:"system",content:sys},{role:"user",content:txt}],{temperature:0.1,maxTokens:2048,jsonMode:true},30000);
      return safeParseJson(content);
    } catch(e) { lastErr=e; console.warn("[LLM] attempt",i,"failed:",e.message); }
  }
  throw lastErr;
}

async function aiMatchFields(hints, resume) {
  if (!hints||hints.length===0) return {};
  const fl=Object.entries({
    full_name:resume.full_name, phone:resume.phone, email:resume.email,
    "education.0.school":resume.education?.[0]?.school, "education.0.major":resume.education?.[0]?.major,
    "education.0.degree":resume.education?.[0]?.degree, "education.0.start_date":resume.education?.[0]?.start_date,
    "education.0.end_date":resume.education?.[0]?.end_date, "work_experience.0.company":resume.work_experience?.[0]?.company,
    "work_experience.0.position":resume.work_experience?.[0]?.position,
    expected_salary:resume.expected_salary, target_city:resume.target_city, self_intro:resume.self_intro,
    gender:resume.gender, birth_date:resume.birth_date, location:resume.location,
    github:resume.github, website:resume.website,
  }).filter(([,v])=>v).map(([k,v])=>`${k}: ${String(v).slice(0,60)}`);
  const prompt="Match resume fields to form hints.\nResume:\n"+fl.join("\n")+"\nHints: "+JSON.stringify(hints)+
    "\nOutput JSON: {\"matches\":{\"index\":{\"path\":\"field\",\"value\":\"value\"}}}";
  try {
    const c=await callLLMProxy([{role:"user",content:prompt}],{temperature:0,maxTokens:512,jsonMode:true},15000);
    return safeParseJson(c).matches||{};
  } catch(e) { console.warn("[aiMatch] failed:",e.message); return {}; }
}


async function makeFillPlan(fields, resume, evolutionMemory = {}) {
  if (!fields||fields.length===0) return {};
  
  // 构建结构化的简历描述
  const sum = buildResumeDescription(resume);
  
  // 构建进化系统记忆描述
  let memoryDesc = '';
  if (evolutionMemory && Object.keys(evolutionMemory).length > 0) {
    const memoryLines = [];
    for (const [key, value] of Object.entries(evolutionMemory)) {
      memoryLines.push(`  ${key}: ${value}`);
    }
    memoryDesc = `\n【用户历史填写记录】（用户曾经手动填写过的字段，可作为补充参考）\n${memoryLines.join('\n')}\n注意：这些是用户历史填写记录，仅供参考，请根据当前字段上下文判断是否适用。\n`;
  }
  
  // Build compact field list
  const SECTION_MAP={
    'basic':'基本信息','edu':'教育经历','education':'教育经历',
    'work':'实习/工作经历','project':'项目经历','award':'获奖经历','lang':'语言能力',
    'skill':'技能特长','course':'主修课程','certificate':'证书','thesis':'论文/专著'
  };
  
  const fieldList=fields.map(f=>{
    const sec=SECTION_MAP[f.section]||SECTION_MAP[f.group_type]||'基本信息';
    const hint=f.hint.replace(/\s+/g,' ').trim().slice(0,60);
    let s=`[${f.id}][${sec}] type:${f.type} label:"${hint}"`;
    if(f.options&&f.options.length>0) s+=` options:[${f.options.slice(0,10).join('|')}]`;
    if(f.ctx&&f.ctx.trim().length>0) s+=` context:"${f.ctx.slice(0,150).replace(/"/g,"'")}"`;
    return s;
  }).join('\n');

  const prompt=
`你是一个专业的招聘网站简历表单填写助手。请根据简历信息，为每个表单字段选择最合适的填写值。

【简历信息】
${sum}
${memoryDesc}
【待填字段】格式: [字段ID][所属分区] type:类型 label:"字段标签" options:[选项列表] context:"上下文"
注意：当 label 信息比较模糊时（比如只有"名称"、"时间"、"描述"），务必结合 context 和所属分区来判断这个字段到底是属于什么内容的！
${fieldList}

【匹配规则】
1. 优先根据分区匹配：
   - 教育经历分区的字段 → 匹配 education 数组
   - 实习/工作经历分区 → 匹配 work_experience 数组
   - 项目经历分区 → 匹配 projects 数组
   - 技能特长分区 → 只匹配 skills（多个技能用逗号连接）
   - 主修课程分区 → 只匹配 courses（不要填 skills）
   - 证书分区 → 只匹配 certificates 数组
   - 获奖经历分区 → 只匹配 awards 数组
   - 论文/专著分区 → 直接跳过，不填写

2. 字段识别规则（严格遵守）：
   - 姓名/真实姓名/您的姓名/中文名 → full_name
   - 手机/电话/联系电话/手机号码/联系电话 → phone
   - 邮箱/电子邮件/email/电子邮箱 → email
   - 性别 → gender（男/女）
   - 出生日期/出生年月/生日 → birth_date
   - 现居地/居住地/住址/所在地/地址/居住地址 → location
   - 学校/毕业院校/就读院校 → education.X.school
   - 专业/专业名称/所学专业 → education.X.major
   - 学历/学位 → education.X.degree
   - 入学时间/开始时间（教育分区）→ education.X.start_date
   - 毕业时间/结束时间（教育分区）→ education.X.end_date
   - 公司/单位/实习单位（实习/工作分区）→ work_experience.X.company
   - 职位/岗位（实习/工作分区）→ work_experience.X.position
   - 工作开始时间/入职时间 → work_experience.X.start_date
   - 工作结束时间/离职时间 → work_experience.X.end_date
   - 工作描述/工作职责/实习内容/工作内容 → work_experience.X.description
   - 项目名称 → projects.X.name（每个项目字段对应一个独立的项目，绝对不能合并）
   - 项目角色/担任角色 → projects.X.role（每个项目字段对应一个独立的项目，绝对不能合并）
   - 项目开始时间 → projects.X.start_date（每个项目字段对应一个独立的项目，绝对不能合并）
   - 项目结束时间 → projects.X.end_date（每个项目字段对应一个独立的项目，绝对不能合并）
   - 项目描述/项目介绍 → projects.X.description（每个项目字段对应一个独立的项目，绝对不能合并）
   - 技能/技能特长/专业技能/技术栈/掌握技能 → skills（多个技能用逗号连接）
   - 课程/主修课程/所学课程 → courses（不要填 skills！）
   - 证书/证书名称/资格证书/职业技能证书/获得证书 → certificates.X.name
   - 证书获得时间/发证时间 → certificates.X.date
   - 语言/语言能力/外语水平 → languages.X.language
   - 语言熟练程度 → languages.X.proficiency
   - 自我介绍/自我评价/自我简介 → self_intro
   - 期望职位/应聘职位/意向职位 → target_position
   - 期望薪资/意向薪资 → expected_salary
   - 期望城市/意向城市/工作城市 → target_city
   - GitHub/GitHub链接/GitHub地址 → github
   - 个人网站/个人主页/博客 → website

3. 【严禁混淆】分区匹配规则（非常重要！）：
   - 字段若位于"获奖经历"分区，只能从 awards 取值，绝不能使用 certificates 或其他数组！
   - 字段若位于"证书"分区，只能从 certificates 取值，绝不能使用 awards 或其他数组！
   - 字段若位于"论文/专著"分区，直接跳过，不填写任何内容！
   - 如果 awards 为空，获奖字段填空字符串，绝不填证书名！
   - 如果 certificates 为空，证书字段填空字符串，绝不填获奖名！

4. 【重要】字段标签为"名称"的特殊处理：
   - 如果字段标签为"名称"，并且上下文或所属分区表明这是证书相关字段，那么填写 certificates.X.name
   - 如果字段标签为"名称"，并且上下文或所属分区表明这是获奖相关字段，那么填写 awards 数组内容（如果有）
   - 如果字段标签为"名称"，并且上下文或所属分区表明这是项目相关字段，那么填写 projects.X.name
   - 绝对不要将证书信息填写到获奖字段或论文/专著字段中！

5. 【重要】绝对禁止填写的敏感字段（直接忽略）：
   - 身份证号/身份证号码/身份证
   - 护照号/护照号码
   - 银行卡号/银行账号
   - 社保号/社保卡号
   - 紧急联系人/紧急联系人电话
   - 家庭住址/家庭地址/籍贯
   - 政治面貌/民族
   - 婚姻状况/是否结婚
   - 健康状况/身高/体重
   - 父母信息/家庭成员

6. 【非常重要】看到以下字段类型直接忽略，绝对不要填写！
   - 论文/专著/论文名称/专著名称/发表论文
   - 专利/专利名称/专利号
   - 创业经历/创业项目
   - 科研成果/学术成果
   - 作品集/作品链接
   - 推荐信/推荐人
   - 社会关系/亲戚关系
   - 培训经历/继续教育
   - 如果字段标签或 context 包含上述任何关键词，直接跳过！

7. 有 options 的字段必须从选项中选择最匹配的一项（输出选项原文），不要自己编造
8. 多条目处理：如果同一分区有多个条目（group_index 不同），分别匹配对应的简历条目
9. 只填写简历中确实存在的信息，没有的字段不要包含在结果中
10. 输出纯 JSON，无需 markdown：{"plan":{"字段ID":{"value":"填写内容","label":"字段名"}}}`;

  console.log('[background] 发送给 LLM 的完整提示词:', prompt);
  const content=await callLLMProxy([{role:'user',content:prompt}],{temperature:0,maxTokens:3000,jsonMode:true},120000);
  console.log('[background] LLM返回原始内容:', content);
  const parsed=safeParseJson(content);
  const plan=parsed.plan||{};
  // Filter out null values
  const result={};
  for(const [id,v] of Object.entries(plan)){
    if(v&&v.value!=null&&v.value!=='') result[id]=v;
  }
  console.log('[background] 最终填写计划:', result);
  return result;
}

function buildResumeDescription(resume) {
  const parts = [];
  
  if (resume.full_name) parts.push(`姓名: ${resume.full_name}`);
  if (resume.phone) parts.push(`手机: ${resume.phone}`);
  if (resume.email) parts.push(`邮箱: ${resume.email}`);
  if (resume.gender) parts.push(`性别: ${resume.gender}`);
  if (resume.birth_date) parts.push(`出生年月: ${resume.birth_date}`);
  if (resume.location) parts.push(`现居地: ${resume.location}`);
  if (resume.target_city) parts.push(`期望城市: ${resume.target_city}`);
  if (resume.expected_salary) parts.push(`期望薪资: ${resume.expected_salary}`);
  if (resume.target_position) parts.push(`期望职位: ${resume.target_position}`);
  if (resume.self_intro) parts.push(`自我介绍: ${String(resume.self_intro).slice(0,200)}`);
  
  if (resume.education && Array.isArray(resume.education) && resume.education.length > 0) {
    resume.education.forEach((edu, i) => {
      parts.push(`教育经历${i+1}:`);
      if (edu.school) parts.push(`  学校: ${edu.school}`);
      if (edu.major) parts.push(`  专业: ${edu.major}`);
      if (edu.degree) parts.push(`  学历: ${edu.degree}`);
      if (edu.start_date) parts.push(`  入学时间: ${edu.start_date}`);
      if (edu.end_date) parts.push(`  毕业时间: ${edu.end_date}`);
    });
  }
  
  if (resume.work_experience && Array.isArray(resume.work_experience) && resume.work_experience.length > 0) {
    resume.work_experience.forEach((work, i) => {
      parts.push(`实习/工作经历${i+1}:`);
      if (work.company) parts.push(`  公司: ${work.company}`);
      if (work.position) parts.push(`  职位: ${work.position}`);
      if (work.start_date) parts.push(`  开始时间: ${work.start_date}`);
      if (work.end_date) parts.push(`  结束时间: ${work.end_date}`);
      if (work.description) parts.push(`  描述: ${String(work.description).slice(0,100)}`);
    });
  }
  
  if (resume.projects && Array.isArray(resume.projects) && resume.projects.length > 0) {
    resume.projects.forEach((proj, i) => {
      parts.push(`项目经历${i+1}:`);
      if (proj.name) parts.push(`  项目名: ${proj.name}`);
      if (proj.role) parts.push(`  角色: ${proj.role}`);
      if (proj.start_date) parts.push(`  开始时间: ${proj.start_date}`);
      if (proj.end_date) parts.push(`  结束时间: ${proj.end_date}`);
      if (proj.description) parts.push(`  描述: ${String(proj.description).slice(0,100)}`);
    });
  }
  
  if (resume.skills && Array.isArray(resume.skills) && resume.skills.length > 0) {
    parts.push(`技能特长: ${resume.skills.join(', ')}`);
  }
  
  if (resume.courses && Array.isArray(resume.courses) && resume.courses.length > 0) {
    parts.push(`主修课程: ${resume.courses.join(', ')}`);
  }
  
  if (resume.languages && Array.isArray(resume.languages) && resume.languages.length > 0) {
    resume.languages.forEach((lang, i) => {
      parts.push(`语言${i+1}: ${lang.language} - ${lang.proficiency}`);
    });
  }
  
  if (resume.certificates && Array.isArray(resume.certificates) && resume.certificates.length > 0) {
    resume.certificates.forEach((cert, i) => {
      parts.push(`证书${i+1}: ${cert.name} (${cert.date || ''})`);
    });
  }
  
  return parts.join('\n');
}

async function smartMatchFields(scannedFields, resume) {
  if (!scannedFields||scannedFields.length===0) return {};
  const sum=[
    resume.full_name&&`姓名: ${resume.full_name}`,
    resume.phone&&`手机: ${resume.phone}`,
    resume.email&&`邮箱: ${resume.email}`,
    resume.gender&&`性别: ${resume.gender}`,
    resume.birth_date&&`出生年月: ${resume.birth_date}`,
    resume.location&&`现居地: ${resume.location}`,
    resume.target_city&&`意向城市: ${resume.target_city}`,
    resume.expected_salary&&`期望薪资: ${resume.expected_salary}`,
    resume.github&&`GitHub: ${resume.github}`,
    resume.website&&`个人网站: ${resume.website}`,
    resume.self_intro&&`自我介绍: ${String(resume.self_intro).slice(0,200)}`,
    resume.education?.[0]&&`学校: ${resume.education[0].school}，专业: ${resume.education[0].major}，学历: ${resume.education[0].degree}，${resume.education[0].start_date}-${resume.education[0].end_date}`,
    resume.work_experience?.[0]&&`公司: ${resume.work_experience[0].company}，职位: ${resume.work_experience[0].position}`,
    Array.isArray(resume.skills)&&resume.skills.length>0&&`技能: ${resume.skills.slice(0,10).join(', ')}`,
    resume.work_experience?.[0]?.description&&`实习内容: ${String(resume.work_experience[0].description).slice(0,100)}`,
    resume.work_experience?.[0]?.start_date&&`实习开始: ${resume.work_experience[0].start_date}`,
    resume.work_experience?.[0]?.end_date&&`实习结束: ${resume.work_experience[0].end_date}`,
    resume.projects?.[0]?.name&&`项目名称: ${resume.projects[0].name}`,
    resume.projects?.[0]?.role&&`项目职务: ${resume.projects[0].role}`,
    resume.projects?.[0]?.description&&`项目描述: ${String(resume.projects[0].description).slice(0,100)}`,
    resume.projects?.[0]?.start_date&&`项目开始: ${resume.projects[0].start_date}`,
    resume.projects?.[0]?.end_date&&`项目结束: ${resume.projects[0].end_date}`,
  ].filter(Boolean).join('\n');
  const BATCH=15;
  const allMatches={};
  for (let i=0;i<scannedFields.length;i+=BATCH) {
    const batch=scannedFields.slice(i,i+BATCH);
    const SECTION_MAP={'basic':'基本信息','edu':'教育经历','work':'实习经历','project':'项目经历','award':'获奖经历','lang':'语言能力'};
    const fd=batch.map(f=>{
      const hint=f.hint.replace(/\s+/g,' ').slice(0,60);
      const sec=SECTION_MAP[f.section]||'基本信息';
      let s=`[${f.id}][${sec}] type:${f.type} label:"${hint}"`;
      if(f.options&&f.options.length>0) s+=` options:[${f.options.slice(0,8).join('|')}]`;
      return s;
    }).join('\n');
    const prompt=
      '你是招聘表单填写专家。根据简历信息，为每个表单字段选择最合适的填写值。\n'+
      '【简历信息】\n'+sum+'\n\n'+
      '【待填字段】（格式: [字段ID] type:类型 label:"字段标签" options:[选项]）\n'+fd+'\n\n'+
      '【规则】\n1.根据label语义匹配简历字段\n2.select/radio/custom-select必须从options选最匹配项（输出选项原文）\n'+
      '3.无法匹配的字段不要包含\n4.输出JSON:{"matches":{"字段ID":{"value":"填入值","label":"字段名"}}}\n5.禁止markdown';
    try {
      const c=await callLLMProxy([{role:'user',content:prompt}],{temperature:0,maxTokens:512,jsonMode:true},40000);
      Object.assign(allMatches,safeParseJson(c).matches||{});
    } catch(e){console.warn('[smartMatch] batch',i,'failed:',e.message);}
  }
  return allMatches;
}

async function parseResume(fileName, fileData) {
  try { const r=await parseViaBackend(fileName,fileData); console.log("[fill] backend ok"); return r; }
  catch(e) { console.warn("[fill] backend unavailable:",e.message); }
  const binary=atob(fileData); const bytes=new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  const ext=fileName.split(".").pop().toLowerCase();
  let text="";
  if (ext==="pdf") text=await extractPdfText(bytes);
  else if (ext==="docx"||ext==="doc") text=await extractDocxText(bytes);
  else throw new Error("Unsupported format: "+ext);
  if (!text||text.trim().length<30) throw new Error(`Could not extract text (${text.trim().length} chars). Start backend for scanned PDFs.`);
  console.log("[fill] frontend extracted",text.length,"chars");
  return await callLLM(text);
}

async function verifyActivationCode(code, deviceId) {
  const resp=await fetchWithTimeout(`${BACKEND_BASE}/api/activate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code,device_id:deviceId})},10000);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json();
}

chrome.runtime.onInstalled.addListener(async () => {
  try { chrome.contextMenus.create({id:CONTEXT_MENU_REPORT,title:"Report fill issue",contexts:["page","selection"]}); } catch(e){}
  try { chrome.contextMenus.create({id:CONTEXT_MENU_HIDE_SITE,title:"Hide fill button here",contexts:["page"]}); } catch(e){}
  await storage.initDefaults();
});

chrome.contextMenus.onClicked.addListener((info,tab)=>{
  if (!tab||!tab.id||!tab.url) return;
  if (info.menuItemId===CONTEXT_MENU_HIDE_SITE) {
    try {
      const url=new URL(tab.url);
      storage.addToBlacklist(url.hostname).then(()=>chrome.tabs.sendMessage(tab.id,{type:"BLACKLIST_UPDATED"}).catch(()=>{})).catch(console.error);
    } catch(e){console.error(e);}
  }
});

let _parseInProgress=false;

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if (!message||!message.type) return;
  switch(message.type) {
    case "GET_STATE":
      storage.getState().then(state=>sendResponse({ok:true,state})).catch(err=>sendResponse({ok:false,error:String(err)}));
      return true;
    case "SET_STATE":
      storage.mergeState(message.patch||{}).then(()=>{
        // 如果更新了 resumeData，同时更新内存缓存
        if (message.patch && message.patch.resumeData) {
          _resumeCache = message.patch.resumeData;
          console.log('[background] SET_STATE: 更新 resume 缓存');
          console.log('[background] 缓存中的 full_name:', _resumeCache.full_name);
          console.log('[background] 完整缓存数据:', _resumeCache);
        }
        sendResponse({ok:true});
      }).catch(err=>{
        console.error('[background] SET_STATE 错误:', err);
        sendResponse({ok:false,error:String(err)});
      });
      return true;
    case "INCREMENT_USAGE":
      storage.incrementUsage().then(c=>sendResponse({ok:true,usageCount:c})).catch(err=>sendResponse({ok:false,error:String(err)}));
      return true;
    case "SAVE_MEMORY": {
      const {siteKey,fieldKey,value}=message;
      storage.getState().then(state=>{
        const all=state.userMemory||{}; const site=all[siteKey]||{};
        site[fieldKey]={value,updatedAt:Date.now()}; all[siteKey]=site;
        return storage.mergeState({userMemory:all});
      }).then(()=>sendResponse({ok:true})).catch(err=>sendResponse({ok:false,error:String(err)}));
      return true;
    }
    case "CLEAR_MEMORY":
      storage.clearAll().then(()=>sendResponse({ok:true})).catch(err=>sendResponse({ok:false,error:String(err)}));
      return true;
    case "PARSE_RESUME": {
      if (_parseInProgress){sendResponse({ok:false,error:"Parse in progress"});return true;}
      _parseInProgress=true;
      const {fileName,fileData}=message;
      parseResume(fileName,fileData)
        .then(data=>{
          _resumeCache = data;
          console.log('[background] 解析完成，更新 resume 缓存');
          storage.mergeState({resumeData:data});
          sendResponse({ok:true,data});
        })
        .catch(err=>sendResponse({ok:false,error:err.message}))
        .finally(()=>{_parseInProgress=false;});
      return true;
    }
    case "ACTIVATE_CODE":
      verifyActivationCode(message.code,message.deviceId)
        .then(result=>{
          if(result.success){
            return storage.mergeState({activationStatus:{activated:true,code:message.code,deviceId:message.deviceId,activatedAt:Date.now()}})
              .then(()=>sendResponse({ok:true,result}));
          }
          sendResponse({ok:false,result});
        }).catch(err=>sendResponse({ok:false,error:String(err)}));
      return true;
    case "AI_MATCH_FIELDS": {
      const {hints,resume}=message;
      aiMatchFields(hints,resume).then(matches=>sendResponse({ok:true,matches})).catch(err=>sendResponse({ok:false,error:String(err)}));
      return true;
    }
    case "SMART_MATCH_FIELDS": {
      const {fields:scannedFields,resume:rd}=message;
      smartMatchFields(scannedFields,rd).then(matches=>sendResponse({ok:true,matches})).catch(err=>sendResponse({ok:false,error:String(err)}));
      return true;
    }
    case "FILL_PLAN": {
      const {fields:planFields,resume:planResume,evolutionMemory}=message;
      console.log('[background] FILL_PLAN: 收到 resume.full_name:', planResume?.full_name);
      console.log('[background] FILL_PLAN: 进化系统记忆:', evolutionMemory);
      makeFillPlan(planFields,planResume,evolutionMemory).then(plan=>{
        console.log('[background] FILL_PLAN: LLM 返回的计划:', plan);
        sendResponse({ok:true,plan});
      }).catch(err=>{
        console.error('[background] FILL_PLAN 错误:', err);
        sendResponse({ok:false,error:String(err)});
      });
      return true;
    }
    case "SAVE_FIELD_MEMORY": {
      const {siteKey,fieldKey,hint:fhint,value:fval}=message;
      storage.setFieldMemory(siteKey,fieldKey,fhint,fval).then(()=>sendResponse({ok:true})).catch(err=>sendResponse({ok:false,error:String(err)}));
      return true;
    }
    case "GET_FIELD_MEMORY": {
      const {siteKey:sk}=message;
      storage.getFieldMemoryAll(sk).then(mem=>sendResponse({ok:true,mem})).catch(err=>sendResponse({ok:false,error:String(err)}));
      return true;
    }
    case "GET_RESUME": {
      // 优先返回内存缓存中的最新数据
      if (_resumeCache) {
        console.log('[background] GET_RESUME: 返回缓存的 resume 数据');
        console.log('[background] 缓存中的 full_name:', _resumeCache.full_name);
        sendResponse({ok:true, resume: _resumeCache});
        return true;
      }
      // 如果缓存为空，从 storage 读取
      storage.getState().then(state => {
        const resume = state.resumeData || null;
        if (resume) {
          _resumeCache = resume;
          console.log('[background] GET_RESUME: 从 storage 读取，缓存 full_name:', resume.full_name);
        } else {
          console.log('[background] GET_RESUME: storage 中没有 resumeData');
        }
        sendResponse({ok:true, resume});
      }).catch(err => {
        console.error('[background] GET_RESUME 错误:', err);
        sendResponse({ok:false, error:String(err)});
      });
      return true;
    }
    case "COLLECT_FORM_DOM": {
      const {data} = message;
      console.log('[background] 收到表单 DOM 采集数据:', data);
      storage.mergeState({lastFormDOM: data, lastFormDOMTime: Date.now()})
        .then(() => sendResponse({ok:true}))
        .catch(err => sendResponse({ok:false, error:String(err)}));
      return true;
    }
    case "SAVE_GLOBAL_FIELD_MEMORY": {
      const {label, section, value, siteKey} = message;
      storage.saveGlobalFieldMemory(label, section, value, siteKey)
        .then(() => sendResponse({ok:true}))
        .catch(err => sendResponse({ok:false, error:String(err)}));
      return true;
    }
    case "GET_GLOBAL_FIELD_MATCH": {
      const {label, section} = message;
      storage.getGlobalFieldMatch(label, section)
        .then(value => sendResponse({ok:true, value}))
        .catch(err => sendResponse({ok:false, error:String(err)}));
      return true;
    }
    case "GET_ALL_GLOBAL_FIELD_MEMORY": {
      storage.getAllGlobalFieldMemory()
        .then(memory => sendResponse({ok:true, memory}))
        .catch(err => sendResponse({ok:false, error:String(err)}));
      return true;
    }
    case "PING": {
      sendResponse({ok:true});
      return false;
    }
    case "CHECK_UPDATE": {
      checkForUpdate()
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ok:false, error:String(err)}));
      return true;
    }
    case "DISMISS_UPDATE": {
      storage.mergeState({ dismissedVersion: message.version })
        .then(() => sendResponse({ok:true}))
        .catch(err => sendResponse({ok:false, error:String(err)}));
      return true;
    }
    case "GET_UPDATE_STATUS": {
      storage.getState().then(state => {
        sendResponse({
          ok: true,
          hasUpdate: state.hasUpdate || false,
          updateInfo: state.updateInfo || null,
          dismissedVersion: state.dismissedVersion || ""
        });
      }).catch(err => sendResponse({ok:false, error:String(err)}));
      return true;
    }
    case "openPopup": {
      chrome.action.openPopup().catch(err => {
        console.log('[background] openPopup failed, trying alternative method');
      });
      sendResponse({ok:true});
      return false;
    }
    case "openUploadPage": {
      chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }, (tab) => {
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { action: 'scrollToUpload' });
        }, 500);
      });
      sendResponse({ok:true});
      return false;
    }
  }
});

// ========== 版本检测系统 ==========
const CURRENT_VERSION = "1.2.0";
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6小时

async function checkForUpdate() {
  try {
    const resp = await fetchWithTimeout(`${BACKEND_BASE}/api/version`, {}, 10000);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    
    const latestVersion = data.latest_version;
    const hasUpdate = compareVersions(latestVersion, CURRENT_VERSION) > 0;
    
    if (hasUpdate) {
      await storage.mergeState({ 
        hasUpdate: true, 
        updateInfo: {
          version: latestVersion,
          download_url: data.update_url,
          changelog: data.update_log
        },
        lastUpdateCheck: Date.now()
      });
      
      // 设置扩展图标小红点
      chrome.action.setBadgeText({ text: "•" });
      chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    } else {
      await storage.mergeState({ 
        hasUpdate: false, 
        lastUpdateCheck: Date.now() 
      });
      chrome.action.setBadgeText({ text: "" });
    }
    
    return { ok: true, hasUpdate, updateInfo: data, currentVersion: CURRENT_VERSION };
  } catch(e) {
    console.error('[background] 版本检测失败:', e);
    return { ok: false, error: String(e) };
  }
}

function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

// 定时检测更新
chrome.alarms.create('checkUpdate', { periodInMinutes: 360 }); // 每6小时
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkUpdate') {
    checkForUpdate();
  }
});

// 启动时检测一次
checkForUpdate();
