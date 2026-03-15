// popup.js - 文件解析通过 background.js 的 PARSE_RESUME 消息执行，不直接调用后端

const IS_DEBUG = false; // 发布模式

function sendMsg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, resp => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(resp);
    });
  });
}

function sendToBackground(msg) {
  return sendMsg(msg);
}

async function getState() {
  const resp = await sendMsg({ type: "GET_STATE" });
  return resp?.ok ? resp.state : {};
}

async function mergeState(patch) {
  await sendMsg({ type: "SET_STATE", patch });
}

// ---- Tab navigation ----
function initTabs() {
  const btns = document.querySelectorAll(".tab-btn");
  const panes = document.querySelectorAll(".tab-pane");
  btns.forEach(btn => {
    btn.addEventListener("click", () => {
      btns.forEach(b => b.classList.remove("active"));
      panes.forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const target = document.getElementById("tab-" + btn.dataset.tab);
      if (target) target.classList.add("active");
    });
  });
}

// ---- UI helpers ----
function setHint(el, msg, type) {
  el.textContent = msg;
  el.className = "hint" + (type ? " " + type : "");
}

function renderStatus(state) {
  const badge = document.getElementById("statusBadge");
  const usageLabel = document.getElementById("usageLabel");
  const dots = document.getElementById("usageDots");
  const activated = state.activationStatus?.activated;
  const usageCount = state.usageCount || 0;
  // 剩余次数 = 3次免费 - 已使用次数 + 奖励次数（usageCount为负数时表示有奖励）
  const remaining = IS_DEBUG ? Infinity : Math.max(0, 3 - usageCount);
  if (activated) {
    badge.textContent = "已激活 PRO";
    badge.className = "badge badge-pro";
    usageLabel.textContent = "无限次使用，感谢支持！";
    dots.innerHTML = "<span style='color:var(--success);font-size:18px'>&#10003;</span>";
  } else if (IS_DEBUG) {
    badge.textContent = "调试模式";
    badge.className = "badge badge-pro";
    usageLabel.textContent = "调试模式：无限次使用";
    dots.innerHTML = "<span style='color:var(--accent2);font-size:12px'>&#8734;</span>";
  } else {
    badge.textContent = "免费版 (剩余" + remaining + "次)";
    badge.className = "badge badge-free";
    usageLabel.textContent = "剩余 " + remaining + " 次免费机会";
    // 显示奖励次数提示
    if (usageCount < 0) {
      usageLabel.textContent = "剩余 " + remaining + " 次（含奖励 " + Math.abs(usageCount) + " 次）";
    }
    dots.innerHTML = [0,1,2].map(i =>
      "<span class='dot " + (i < Math.min(usageCount, 3) ? "dot-empty" : "dot-used") + "'></span>"
    ).join("");
  }
}

// ========== 更新检测 ==========
async function checkForUpdates() {
  try {
    const resp = await sendToBackground({ type: 'GET_UPDATE_STATUS' });
    if (resp?.ok && resp.hasUpdate) {
      const state = await sendToBackground({ type: 'GET_STATE' });
      if (state?.ok && state.state?.dismissedVersion === resp.updateInfo?.version) {
        return;
      }
      showUpdateBanner(resp.updateInfo);
    }
  } catch(e) {
    console.error('[popup] 检测更新失败:', e);
  }
}

function showUpdateBanner(updateInfo) {
  const banner = document.getElementById('updateBanner');
  const newVersionEl = document.getElementById('newVersion');
  const btnUpdate = document.getElementById('btnUpdate');
  const btnDismiss = document.getElementById('btnDismissUpdate');
  
  if (!banner || !updateInfo) return;
  
  newVersionEl.textContent = updateInfo.version;
  banner.style.display = 'flex';
  
  btnUpdate.addEventListener('click', () => {
    if (updateInfo.download_url) {
      chrome.tabs.create({ url: updateInfo.download_url });
    }
  });
  
  btnDismiss.addEventListener('click', async () => {
    banner.style.display = 'none';
    await sendToBackground({ type: 'DISMISS_UPDATE', version: updateInfo.version });
  });
}

async function loadConfigFromBackend() {
  try {
    const IS_DEBUG = false;
    const BACKEND = IS_DEBUG ? "http://127.0.0.1:8200" : "http://62.234.168.105:8200";
    
    const resp = await fetch(`${BACKEND}/api/version`);
    if (!resp.ok) return;
    
    const config = await resp.json();
    
    const linkOfficial = document.getElementById('linkOfficial');
    const linkPrivacy = document.getElementById('linkPrivacy');
    const linkBuy = document.getElementById('linkBuy');
    const shareTipMaibao = document.getElementById('shareTipMaibao');
    
    if (linkOfficial && config.official_website) {
      linkOfficial.href = config.official_website;
    }
    if (linkPrivacy && config.privacy_url) {
      linkPrivacy.href = config.privacy_url;
    }
    if (linkBuy && config.buy_url) {
      linkBuy.href = config.buy_url;
    }
    if (shareTipMaibao && config.maibao_keyword) {
      shareTipMaibao.textContent = `说明在面包多搜索"${config.maibao_keyword}"可下载`;
    }
    
    console.log('[配置] 已从后端加载配置:', config);
  } catch (e) {
    console.warn('[配置] 加载后端配置失败:', e);
  }
}

async function init() {
  initTabs();
  checkForUpdates();
  loadConfigFromBackend();

  const resumeFileEl     = document.getElementById('resumeFile');
  const fileDropTextEl   = document.getElementById('fileDropText');
  const btnParseEl       = document.getElementById('btnParse');
  const parseStatusEl    = document.getElementById('parseStatus');
  const btnSaveJsonEl    = document.getElementById('btnSaveJson');
  const btnResetJsonEl   = document.getElementById('btnResetJson');
  const btnFillCurrentEl = document.getElementById('btnFillCurrent');
  const activationCodeEl = document.getElementById('activationCode');
  const btnActivateEl    = document.getElementById('btnActivate');
  const activationStatusEl = document.getElementById('activationStatus');
  const btnClearMemoryEl = document.getElementById('btnClearMemory');

  let latestServerResume = null;
  let editedResume = null;

  // ---- Resume editor helpers ----
  function resumeToHtml(data) {
    if (!data) return '<div class="resume-placeholder">解析结果将显示在这里...</div>';
    const field = (label, val, key, multiline) => {
      const id = 'rf_' + key;
      if (multiline) {
        return `<div class="rf-row"><label class="rf-label">${label}</label><textarea class="rf-val" id="${id}" data-key="${key}" rows="3">${val||''}</textarea></div>`;
      }
      return `<div class="rf-row"><label class="rf-label">${label}</label><input class="rf-val" id="${id}" data-key="${key}" value="${(val||'').replace(/"/g,'&quot;')}" /></div>`;
    };
    let html = '<div class="rf-section-title">基本信息</div>';
    html += field('姓名', data.full_name, 'full_name');
    html += field('手机', data.phone, 'phone');
    html += field('邮箱', data.email, 'email');
    html += field('性别', data.gender, 'gender');
    html += field('出生年月', data.birth_date, 'birth_date');
    html += field('现居地', data.location, 'location');
    html += field('民族', data.ethnicity, 'ethnicity');
    html += field('籍贯', data.hometown, 'hometown');
    html += field('户口所在地', data.hukou, 'hukou');
    html += field('政治面貌', data.political_status, 'political_status');
    html += field('期望职位', data.target_position, 'target_position');
    html += field('期望工作城市', data.target_city, 'target_city');
    html += field('期望薪资', data.expected_salary, 'expected_salary');
    html += field('自我评价', data.self_intro, 'self_intro', true);
    html += field('技能特长', (data.skills||[]).join(', '), 'skills');
    if (data.education && data.education.length > 0) {
      html += '<div class="rf-section-title">教育经历</div>';
      data.education.forEach((e, i) => {
        html += `<div class="rf-group">`;
        html += field('学校', e.school, `education.${i}.school`);
        html += field('专业', e.major, `education.${i}.major`);
        html += field('学历', e.degree, `education.${i}.degree`);
        html += field('入学', e.start_date, `education.${i}.start_date`);
        html += field('毕业', e.end_date, `education.${i}.end_date`);
        html += '</div>';
      });
    }
    if (data.work_experience && data.work_experience.length > 0) {
      html += '<div class="rf-section-title">实习/工作经历</div>';
      data.work_experience.forEach((w, i) => {
        html += `<div class="rf-group">`;
        html += field('公司', w.company, `work_experience.${i}.company`);
        html += field('职位', w.position, `work_experience.${i}.position`);
        html += field('开始', w.start_date, `work_experience.${i}.start_date`);
        html += field('结束', w.end_date, `work_experience.${i}.end_date`);
        html += field('描述', w.description, `work_experience.${i}.description`, true);
        html += '</div>';
      });
    }
    if (data.projects && data.projects.length > 0) {
      html += '<div class="rf-section-title">项目经历</div>';
      data.projects.forEach((p, i) => {
        html += `<div class="rf-group">`;
        html += field('项目名', p.name, `projects.${i}.name`);
        html += field('角色', p.role, `projects.${i}.role`);
        html += field('开始', p.start_date, `projects.${i}.start_date`);
        html += field('结束', p.end_date, `projects.${i}.end_date`);
        html += field('描述', p.description, `projects.${i}.description`, true);
        html += '</div>';
      });
    }
    if (data.languages && data.languages.length > 0) {
      html += '<div class="rf-section-title">语言能力</div>';
      data.languages.forEach((l, i) => {
        html += `<div class="rf-group">`;
        html += field('语言', l.language, `languages.${i}.language`);
        html += field('熟练度', l.proficiency, `languages.${i}.proficiency`);
        html += '</div>';
      });
    }
    if (data.certificates && data.certificates.length > 0) {
      html += '<div class="rf-section-title">证书</div>';
      data.certificates.forEach((c, i) => {
        html += `<div class="rf-group">`;
        html += field('证书名', c.name, `certificates.${i}.name`);
        html += field('时间', c.date, `certificates.${i}.date`);
        html += '</div>';
      });
    }
    return html;
  }

  function setNestedKey(obj, path, val) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = isNaN(parts[i]) ? parts[i] : Number(parts[i]);
      if (cur[k] === undefined || cur[k] === null) cur[k] = isNaN(parts[i+1]) ? {} : [];
      cur = cur[k];
    }
    const lastKey = isNaN(parts[parts.length-1]) ? parts[parts.length-1] : Number(parts[parts.length-1]);
    cur[lastKey] = val;
  }

  function collectEdits(baseData) {
    const data = JSON.parse(JSON.stringify(baseData));
    const editor = document.getElementById('resumeEditor');
    const collected = {};
    
    editor.querySelectorAll('[data-key]').forEach(el => {
      const key = el.dataset.key;
      let val = el.value || '';
      collected[key] = val;
      
      if (key === 'skills') {
        data.skills = val.split(',').map(s => s.trim()).filter(Boolean);
        return;
      }
      
      setNestedKey(data, key, val);
    });
    
    // 重新生成 _raw_text，包含所有字段
    const rawTextParts = [];
    
    // 基本信息
    if (data.full_name) rawTextParts.push(data.full_name);
    if (data.email) rawTextParts.push(data.email);
    if (data.phone) rawTextParts.push(data.phone);
    if (data.gender) rawTextParts.push(data.gender);
    if (data.birth_date) rawTextParts.push(data.birth_date);
    if (data.location) rawTextParts.push(data.location);
    if (data.ethnicity) rawTextParts.push(data.ethnicity);
    if (data.hometown) rawTextParts.push(data.hometown);
    if (data.hukou) rawTextParts.push(data.hukou);
    if (data.political_status) rawTextParts.push(data.political_status);
    if (data.target_position) rawTextParts.push(data.target_position);
    if (data.target_city) rawTextParts.push(data.target_city);
    if (data.expected_salary) rawTextParts.push(data.expected_salary);
    if (data.self_intro) rawTextParts.push(data.self_intro);
    if (data.skills && Array.isArray(data.skills)) rawTextParts.push(data.skills.join(', '));
    
    // 教育经历
    if (data.education && Array.isArray(data.education)) {
      data.education.forEach(e => {
        if (e.school) rawTextParts.push(e.school);
        if (e.major) rawTextParts.push(e.major);
        if (e.degree) rawTextParts.push(e.degree);
        if (e.start_date) rawTextParts.push(e.start_date);
        if (e.end_date) rawTextParts.push(e.end_date);
      });
    }
    
    // 工作经历
    if (data.work_experience && Array.isArray(data.work_experience)) {
      data.work_experience.forEach(w => {
        if (w.company) rawTextParts.push(w.company);
        if (w.position) rawTextParts.push(w.position);
        if (w.start_date) rawTextParts.push(w.start_date);
        if (w.end_date) rawTextParts.push(w.end_date);
        if (w.description) rawTextParts.push(w.description);
      });
    }
    
    // 项目经历
    if (data.projects && Array.isArray(data.projects)) {
      data.projects.forEach(p => {
        if (p.name) rawTextParts.push(p.name);
        if (p.role) rawTextParts.push(p.role);
        if (p.start_date) rawTextParts.push(p.start_date);
        if (p.end_date) rawTextParts.push(p.end_date);
        if (p.description) rawTextParts.push(p.description);
      });
    }
    
    // 语言能力
    if (data.languages && Array.isArray(data.languages)) {
      data.languages.forEach(l => {
        if (l.language) rawTextParts.push(l.language);
        if (l.proficiency) rawTextParts.push(l.proficiency);
      });
    }
    
    // 证书
    if (data.certificates && Array.isArray(data.certificates)) {
      data.certificates.forEach(c => {
        if (c.name) rawTextParts.push(c.name);
        if (c.date) rawTextParts.push(c.date);
      });
    }
    
    data._raw_text = rawTextParts.join('\n');
    
    return data;
  }

  function renderResumeEditor(data) {
    const editor = document.getElementById('resumeEditor');
    editor.innerHTML = resumeToHtml(data);
  }

  let state = await getState();
  renderStatus(state);
  if (state.resumeData) {
    editedResume = state.resumeData;
    renderResumeEditor(editedResume);
  }

  // Float mode radio
  const radios = document.querySelectorAll('input[name="floatMode"]');
  radios.forEach(r => {
    if (r.value === (state.floatMode || "smart")) r.checked = true;
    r.addEventListener("change", async () => {
      await mergeState({ floatMode: r.value });
    });
  });

  // File selection display
  resumeFileEl.addEventListener("change", () => {
    const file = resumeFileEl.files && resumeFileEl.files[0];
    fileDropTextEl.textContent = file ? file.name : "点击选择 PDF / DOCX 文件";
    
    // 用户选择文件时就显示隐私提示
    const privacyNotice = document.getElementById('privacyNotice');
    if (file && privacyNotice) {
      privacyNotice.style.display = 'block';
    }
  });

  // ---- Parse resume ----
  btnParseEl.addEventListener("click", async () => {
    const file = resumeFileEl.files && resumeFileEl.files[0];
    if (!file) {
      setHint(parseStatusEl, "请先选择 PDF / DOCX 文件。", "error");
      return;
    }
    if (!IS_DEBUG) {
      const s = await getState();
      if (!s.activationStatus?.activated && (s.usageCount || 0) >= 3) {
        setHint(parseStatusEl, "免费次数已用完，请激活后继续使用。", "error");
        return;
      }
      
      // 防护：检查是否为新安装（1小时内），新安装用户需要等待
      const installTime = s.installTime || 0;
      const hoursSinceInstall = (Date.now() - installTime) / (1000 * 60 * 60);
      if (installTime > 0 && hoursSinceInstall < 0.5 && (s.usageCount || 0) === 0) {
        const waitMinutes = Math.ceil((0.5 - hoursSinceInstall) * 60);
        setHint(parseStatusEl, `新安装用户请等待 ${waitMinutes} 分钟后再使用，感谢理解！`, "warning");
        return;
      }
    }
    btnParseEl.disabled = true;
    btnParseEl.textContent = "解析中...";
    setHint(parseStatusEl, "正在读取文件并调用 AI 解析，普通简历约 10-30 秒，扫描版简历约 30-90 秒...");
    try {
      // 直接从 popup 发送到后端，避免经过 service worker（MV3 长任务超时问题）
      const IS_DEBUG = false;
      const BACKEND = IS_DEBUG ? "http://127.0.0.1:8200" : "http://62.234.168.105:8200";
      let parsed = null;

      // 先尝试直连后端（支持 OCR，最可靠）
      try {
        const form = new FormData();
        form.append("file", file, file.name);
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 90000); // 90s 超时
        const resp = await fetch(`${BACKEND}/parse-resume`, {
          method: "POST", body: form, signal: ctrl.signal
        });
        clearTimeout(tid);
        if (!resp.ok) {
          const errText = await resp.text().catch(() => "");
          throw new Error(`后端 HTTP ${resp.status}: ${errText.slice(0, 200)}`);
        }
        parsed = await resp.json();
        console.log("[简历快填] popup 直连后端解析成功");
      } catch (backendErr) {
        console.warn("[简历快填] 后端不可用，降级 background 解析:", backendErr.message);
        // 降级：通过 background.js（前端纯 JS 解析，不支持扫描版）
        const arrayBuffer = await file.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        let binary = "";
        const chunkSize = 8192;
        for (let i = 0; i < uint8.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunkSize));
        }
        const fileData = btoa(binary);
        const resp2 = await sendMsg({ type: "PARSE_RESUME", fileName: file.name, fileData });
        if (!resp2 || !resp2.ok) throw new Error(resp2?.error || "background 解析失败");
        parsed = resp2.data;
      }

      if (!parsed) throw new Error("解析结果为空");
      latestServerResume = parsed;
      editedResume = parsed;
      renderResumeEditor(parsed);
      setHint(parseStatusEl, "解析成功，已保存到本地。", "success");
      await sendMsg({ type: "SET_STATE", patch: { resumeData: parsed } });
      await sendMsg({ type: "INCREMENT_USAGE" });
      state = await getState();
      renderStatus(state);
    } catch (e) {
      console.error(e);
      setHint(parseStatusEl, "解析失败：" + e.message, "error");
    } finally {
      btnParseEl.disabled = false;
      btnParseEl.textContent = "上传并解析";
    }
  });

  // Save edits
  btnSaveJsonEl.addEventListener('click', async () => {
    try {
      if (!editedResume) { setHint(parseStatusEl, '暂无简历数据。', 'error'); return; }
      const data = collectEdits(editedResume);
      editedResume = data;
      await mergeState({ resumeData: data });
      setHint(parseStatusEl, '已保存到本地。', 'success');
    } catch (e) {
      setHint(parseStatusEl, '保存失败：' + e.message, 'error');
    }
  });

  // Reset to last parsed result
  btnResetJsonEl.addEventListener('click', () => {
    if (!latestServerResume) { setHint(parseStatusEl, '当前会话暂无解析结果。', 'error'); return; }
    editedResume = latestServerResume;
    renderResumeEditor(latestServerResume);
    setHint(parseStatusEl, '已恢复为本次解析结果。', 'success');
  });

  // Fill current page
  btnFillCurrentEl.addEventListener("click", async () => {
    try {
      // 检查使用次数限制
      if (!IS_DEBUG) {
        const s = await getState();
        if (!s.activationStatus?.activated && (s.usageCount || 0) >= 3) {
          setHint(parseStatusEl, "免费次数已用完，请激活后继续使用。", "error");
          return;
        }
        
        // 防护：检查是否为新安装（30分钟内），新安装用户需要等待
        const installTime = s.installTime || 0;
        const hoursSinceInstall = (Date.now() - installTime) / (1000 * 60 * 60);
        if (installTime > 0 && hoursSinceInstall < 0.5 && (s.usageCount || 0) === 0) {
          const waitMinutes = Math.ceil((0.5 - hoursSinceInstall) * 60);
          setHint(parseStatusEl, `新安装用户请等待 ${waitMinutes} 分钟后再使用，感谢理解！`, "warning");
          return;
        }
      }
      
      console.log('[快填] 点击"立即填写"，当前 editedResume.full_name:', editedResume?.full_name);
      
      // 先自动保存编辑
      if (editedResume) {
        const data = collectEdits(editedResume);
        console.log('[快填] collectEdits 返回的 data.full_name:', data.full_name);
        console.log('[快填] collectEdits 返回的 _raw_text 前200字:', data._raw_text?.slice(0, 200));
        editedResume = data;
        
        console.log('[快填] 调用 mergeState，准备保存');
        await mergeState({ resumeData: data });
        console.log("[快填] mergeState 完成");
        
        // 等待 storage 写入完成
        await new Promise(r => setTimeout(r, 200));
        
        // 验证 storage 中的数据
        const state = await getState();
        console.log('[快填] storage 中的 resumeData.full_name:', state.resumeData?.full_name);
      }
      
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab || !tab.id) return;
      
      console.log('[快填] 发送 TRIGGER_FILL 消息到 content-script');
      chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_FILL" }, resp => {
        if (chrome.runtime.lastError) {
          setHint(parseStatusEl, "无法连接到当前页面，请刷新后重试。", "error");
        }
      });
      
      setTimeout(() => window.close(), 300);
    } catch (e) {
      console.error('[快填] 错误:', e);
      setHint(parseStatusEl, "保存失败：" + e.message, "error");
    }
  });

  // Activate code
  btnActivateEl.addEventListener("click", async () => {
    const raw = (activationCodeEl.value || "").trim();
    if (!raw) { setHint(activationStatusEl, "请输入激活码。", "error"); return; }
    btnActivateEl.disabled = true;
    setHint(activationStatusEl, "正在激活，请稍候...");
    try {
      let s = await getState();
      let deviceId = s.activationStatus && s.activationStatus.deviceId;
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        await mergeState({ activationStatus: Object.assign({}, s.activationStatus || {}, { deviceId }) });
      }
      const resp = await sendMsg({ type: "ACTIVATE_CODE", code: raw, deviceId });
      if (resp && resp.ok && resp.result && resp.result.success) {
        setHint(activationStatusEl, "激活成功，感谢支持！", "success");
        state = await getState();
        renderStatus(state);
      } else {
        const msg = (resp && resp.result && resp.result.message) || (resp && resp.error) || "激活失败，请检查激活码。";
        setHint(activationStatusEl, msg, "error");
      }
    } catch (e) {
      setHint(activationStatusEl, "网络异常：" + e.message, "error");
    } finally {
      btnActivateEl.disabled = false;
    }
  });

  // Clear all data
  btnClearMemoryEl.addEventListener('click', async () => {
    if (!confirm('确定要清空所有本地数据吗？此操作不可恢复。')) return;
    await sendMsg({ type: 'CLEAR_MEMORY' });
    editedResume = null;
    latestServerResume = null;
    renderResumeEditor(null);
    state = await getState();
    renderStatus(state);
    setHint(parseStatusEl, '已清空所有本地数据。', 'success');
  });

  // ===== 分享赚次数功能 =====
  const sharePlatformEl = document.getElementById('sharePlatform');
  const shareUrlEl = document.getElementById('shareUrl');
  const shareDescEl = document.getElementById('shareDesc');
  const btnSubmitShareEl = document.getElementById('btnSubmitShare');
  const shareStatusEl = document.getElementById('shareStatus');
  const shareHistoryEl = document.getElementById('shareHistory');

  // 加载分享历史
  async function loadShareHistory() {
    try {
      const s = await getState();
      const deviceId = s.activationStatus?.deviceId;
      if (!deviceId) return;

      const IS_DEBUG = false;
      const BACKEND = IS_DEBUG ? "http://127.0.0.1:8200" : "http://62.234.168.105:8200";
      
      const resp = await fetch(`${BACKEND}/api/share-status?device_id=${encodeURIComponent(deviceId)}`);
      const data = await resp.json();
      
      if (data.success && data.submissions && data.submissions.length > 0) {
        const statusMap = {
          'pending': '⏳ 待审核',
          'approved': '✅ 已通过',
          'rejected': '❌ 已拒绝'
        };
        
        shareHistoryEl.innerHTML = data.submissions.slice(0, 5).map(sub => `
          <div class="share-history-item">
            <span class="platform">${sub.platform}</span>
            <span class="status ${sub.status}">${statusMap[sub.status] || sub.status}</span>
            ${sub.status === 'approved' && sub.usage_granted ? `<span style="color:var(--success)">+${sub.usage_granted}次</span>` : ''}
            ${sub.status === 'rejected' && sub.reject_reason ? `<br><small style="color:var(--danger)">原因: ${sub.reject_reason}</small>` : ''}
            <div class="time">${sub.submitted_at}</div>
          </div>
        `).join('');
      } else {
        shareHistoryEl.innerHTML = '';
      }
    } catch (e) {
      console.error('[分享] 加载历史失败:', e);
    }
  }

  // 领取奖励次数
  async function claimShareReward() {
    try {
      let s = await getState();
      let deviceId = s.activationStatus?.deviceId;
      
      // 如果没有 deviceId，尝试获取或创建
      if (!deviceId) {
        deviceId = s.deviceFingerprint;
        if (!deviceId) {
          deviceId = crypto.randomUUID();
        }
        // 保存 deviceId
        await mergeState({ 
          activationStatus: Object.assign({}, s.activationStatus || {}, { deviceId }) 
        });
      }

      
      const IS_DEBUG = false;
      const BACKEND = IS_DEBUG ? "http://127.0.0.1:8200" : "http://62.234.168.105:8200";
      
      const resp = await fetch(`${BACKEND}/api/share-claim?device_id=${encodeURIComponent(deviceId)}`);
      const data = await resp.json();
      
      if (data.success && data.new_usage > 0) {
        // 更新本地使用次数（减少已使用次数 = 增加剩余次数）
        const currentState = await getState();
        const currentUsage = currentState.usageCount || 0;
        const newUsage = currentUsage - data.new_usage;
        await mergeState({ usageCount: newUsage });
        
        state = await getState();
        renderStatus(state);
        
        setHint(shareStatusEl, `🎉 恭喜！您获得了 ${data.new_usage} 次使用机会！`, 'success');
      }
    } catch (e) {
      console.error('[分享] 领取奖励失败:', e);
    }
  }

  // 提交分享
  if (btnSubmitShareEl) {
    btnSubmitShareEl.addEventListener('click', async () => {
      const platform = sharePlatformEl.value;
      const contentUrl = shareUrlEl.value.trim();
      const screenshotDesc = shareDescEl.value.trim();

      if (!platform) {
        setHint(shareStatusEl, '请选择分享平台。', 'error');
        return;
      }
      if (!contentUrl) {
        setHint(shareStatusEl, '请填写作品链接。', 'error');
        return;
      }
      if (!contentUrl.startsWith('http://') && !contentUrl.startsWith('https://')) {
        setHint(shareStatusEl, '请填写完整的链接（以 http 开头）。', 'error');
        return;
      }

      btnSubmitShareEl.disabled = true;
      btnSubmitShareEl.textContent = '提交中...';
      setHint(shareStatusEl, '正在提交...');

      try {
        let s = await getState();
        let deviceId = s.activationStatus?.deviceId;
        if (!deviceId) {
          deviceId = crypto.randomUUID();
          await mergeState({ activationStatus: Object.assign({}, s.activationStatus || {}, { deviceId }) });
        }

        const IS_DEBUG = false;
        const BACKEND = IS_DEBUG ? "http://127.0.0.1:8200" : "http://62.234.168.105:8200";

        const resp = await fetch(`${BACKEND}/api/share-submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_id: deviceId,
            platform: platform,
            content_url: contentUrl,
            screenshot_desc: screenshotDesc
          })
        });

        const data = await resp.json();

        if (data.success) {
          setHint(shareStatusEl, data.message || '提交成功！请等待审核。', 'success');
          sharePlatformEl.value = '';
          shareUrlEl.value = '';
          shareDescEl.value = '';
          loadShareHistory();
        } else {
          setHint(shareStatusEl, data.message || '提交失败，请稍后重试。', 'error');
        }
      } catch (e) {
        setHint(shareStatusEl, '网络异常：' + e.message, 'error');
      } finally {
        btnSubmitShareEl.disabled = false;
        btnSubmitShareEl.textContent = '提交审核';
      }
    });

    // 初始化时加载历史和领取奖励
    loadShareHistory();
    claimShareReward();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch(console.error);
});
