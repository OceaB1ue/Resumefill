// rulesEngine.js - 表单匹配与自动填充逻辑

function getDomain(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function getSiteKey(url) {
  return getDomain(url).replace(/^www\./, "");
}

function isRecruitSite(url, siteRules) {
  const domain = getDomain(url);
  if (!siteRules) return false;
  const whitelist = siteRules.domain_whitelist || [];
  if (whitelist.some(d => domain.endsWith(d))) return true;
  const urlKeywords = siteRules.url_keywords || [];
  if (urlKeywords.some(k => url.includes(k))) return true;
  return false;
}

function applyUserMemory(doc, url, userMemory) {
  if (!userMemory) return;
  const siteKey = getSiteKey(url);
  const siteMemory = userMemory[siteKey];
  if (!siteMemory) return;
  const inputs = Array.from(doc.querySelectorAll("input, textarea, select"));
  for (const el of inputs) {
    const fieldKey = [el.name||"", el.id||"", el.placeholder||"", el.type||"", el.tagName||""]
      .join("|").toLowerCase();
    const mem = siteMemory[fieldKey];
    if (!mem || !mem.value) continue;
    setFieldValue(el, mem.value);
  }
}

function setFieldValue(el, value) {
  if (!el || value === undefined || value === null) return;
  const tag = el.tagName;
  if (tag === "SELECT") {
    // 尝试按值匹配，否则按文字匹配
    const opts = Array.from(el.options);
    const match = opts.find(o => o.value === value || o.text === value);
    if (match) {
      el.value = match.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }
  // 用 nativeInputValueSetter 兼容 React 受控组件
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillBySelectors(doc, value, selectors) {
  if (!value || !selectors || !selectors.length) return false;
  for (const sel of selectors) {
    try {
      const el = doc.querySelector(sel);
      if (!el) continue;
      setFieldValue(el, value);
      return true;
    } catch { /* ignore invalid selector */ }
  }
  return false;
}

// 通用启发式填充 - 按字段语义推断
function heuristicFill(doc, resume) {
  let filled = 0;
  const inputs = Array.from(doc.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea'
  ));

  const rules = [
    { fields: ["full_name", "name"], keywords: ["姓名", "name", "realname", "full_name", "真实姓名", "您的姓名"] },
    { fields: ["phone"],            keywords: ["手机", "电话", "phone", "mobile", "tel", "联系方式"] },
    { fields: ["email"],            keywords: ["邮箱", "email", "mail", "e-mail"] },
    { fields: ["education[0].school"],   keywords: ["学校", "毕业院校", "school", "university", "college", "院校"] },
    { fields: ["education[0].major"],    keywords: ["专业", "major", "专业名称"] },
    { fields: ["education[0].degree"],   keywords: ["学历", "degree", "最高学历"] },
    { fields: ["work_experience[0].company"],  keywords: ["公司", "company", "单位", "企业"] },
    { fields: ["work_experience[0].position"], keywords: ["职位", "岗位", "position", "title", "职务"] },
  ];

  function getResumeValue(fieldPath) {
    const parts = fieldPath.split(/[.\[\]]+/).filter(Boolean);
    let val = resume;
    for (const p of parts) {
      if (val === null || val === undefined) return null;
      val = val[isNaN(p) ? p : Number(p)];
    }
    if (Array.isArray(val)) return val.join("、");
    return val !== undefined ? String(val) : null;
  }

  for (const el of inputs) {
    if (el.value && el.value.trim()) continue; // 已有值，跳过
    const hint = [
      el.name, el.id, el.placeholder,
      el.getAttribute("aria-label"), el.getAttribute("data-label"),
      el.closest("label")?.textContent, el.previousElementSibling?.textContent
    ].join(" ").toLowerCase();

    for (const rule of rules) {
      if (rule.keywords.some(k => hint.includes(k.toLowerCase()))) {
        for (const fieldPath of rule.fields) {
          const value = getResumeValue(fieldPath);
          if (value) {
            setFieldValue(el, value);
            filled++;
            break;
          }
        }
        break;
      }
    }
  }
  return filled;
}

export const rulesEngine = {
  isRecruitSite,
  getSiteKey,

  async shouldShowFloatButton(url, state) {
    const domain = getDomain(url);
    if ((state.blacklistDomains || []).includes(domain)) return false;
    const mode = state.floatMode || "smart";
    if (mode === "hidden") return false;
    if (mode === "always") return true;
    // smart 模式
    return isRecruitSite(url, state.siteRules);
  },

  async fillPage(doc, url, state) {
    const resume = state.resumeData;
    if (!resume) return { success: false, reason: "no_resume" };

    let filled = 0;
    const siteKey = getSiteKey(url);
    const siteSpecificRules = state.rules?.sites?.[siteKey] || {};

    // 1. 用服务器下发的选择器规则精确填充
    filled += fillBySelectors(doc, resume.full_name, siteSpecificRules.full_name) ? 1 : 0;
    filled += fillBySelectors(doc, resume.phone, siteSpecificRules.phone) ? 1 : 0;
    filled += fillBySelectors(doc, resume.email, siteSpecificRules.email) ? 1 : 0;

    // 2. 启发式语义填充（覆盖更多字段）
    filled += heuristicFill(doc, resume);

    // 3. 用户记忆值覆盖（用户手动改过的优先）
    applyUserMemory(doc, url, state.userMemory || {});

    return { success: true, filled };
  }
};
