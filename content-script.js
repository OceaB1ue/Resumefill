// content-script.js - 完整重写版，采用 LLM 智能匹配 + 日期选择器专门处理
'use strict';

const IS_DEBUG = false;

// ========== 工具函数 ==========
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function getDomain(url) { try { return new URL(url).hostname; } catch { return ''; } }

const DEFAULT_DOMAINS = ['zhaopin.com','51job.com','liepin.com','bosszhipin.com','lagou.com',
  'nowcoder.com','shixiseng.com','zhiye.com','mokahr.com','yingjiesheng.com',
  'job.campus.cn','maimai.cn','linken.com'];
const DEFAULT_KEYWORDS = ['job','campus','recruit','career','apply','校招','招聘','投递'];

let _cachedDomains = null;
async function getSupportedDomains() {
  if (_cachedDomains) return _cachedDomains;
  try {
    const resp = await sendToBackground({ type: 'GET_SITE_RULES' });
    if (resp?.ok && resp.rules?.domain_whitelist) {
      _cachedDomains = resp.rules.domain_whitelist;
      return _cachedDomains;
    }
  } catch(e) {}
  return DEFAULT_DOMAINS;
}

function isRecruitSite(url) {
  const d = getDomain(url);
  const domains = _cachedDomains || DEFAULT_DOMAINS;
  if (domains.some(x => d.endsWith(x))) return true;
  const kws = DEFAULT_KEYWORDS;
  return kws.some(k => url.toLowerCase().includes(k));
}

async function initSiteRules() {
  await getSupportedDomains();
}

function shouldShowButton(url, state) {
  const d = getDomain(url);
  if ((state.blacklistDomains || []).includes(d)) return false;
  const m = state.floatMode || 'smart';
  if (m === 'hidden') return false;
  if (m === 'always') return true;
  return isRecruitSite(url);
}

function sendToBackground(msg) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, resp => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(resp);
      });
    } catch(e) { reject(e); }
  });
}

// ========== Toast 提示 ==========
function showToast(msg, type = 'info', duration = 3500) {
  const ex = document.getElementById('rqf-toast');
  if (ex) ex.remove();
  const colors = { success: '#22c55e', warn: '#f59e0b', error: '#ef4444', info: '#6c63ff' };
  const t = document.createElement('div');
  t.id = 'rqf-toast';
  t.style.cssText = [
    'position:fixed','bottom:20px','left:50%','transform:translateX(-50%)',
    'z-index:2147483647','background:#1a1d27','color:#e2e8f0',
    'border:1.5px solid '+(colors[type]||colors.info),
    'border-radius:10px','padding:12px 24px','font-size:14px',
    'font-family:-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif',
    'box-shadow:0 8px 30px rgba(0,0,0,.4)','max-width:420px','text-align:center',
    'line-height:1.5','pointer-events:none'
  ].join(';');
  t.textContent = msg;
  document.documentElement.appendChild(t);
  setTimeout(() => { if (t.parentNode) t.remove(); }, duration);
}

function showNoResumeDialog() {
  const existing = document.getElementById('rqf-no-resume-dialog');
  if (existing) existing.remove();
  
  const dialog = document.createElement('div');
  dialog.id = 'rqf-no-resume-dialog';
  dialog.innerHTML = `
    <div class="rqf-dialog-overlay"></div>
    <div class="rqf-dialog-content">
      <div class="rqf-dialog-icon">📄</div>
      <div class="rqf-dialog-title">请先上传简历</div>
      <div class="rqf-dialog-text">
        您还没有上传简历，无法自动填写表单。<br>
        请按照以下步骤上传简历。
      </div>
      <div class="rqf-dialog-steps">
        <div class="rqf-step-item">
          <span class="rqf-step-num">1</span>
          <span class="rqf-step-text">点击浏览器工具栏右侧的 <b>拼图图标</b> 🧩</span>
        </div>
        <div class="rqf-step-item">
          <span class="rqf-step-num">2</span>
          <span class="rqf-step-text">在列表中找到并点击 <b>简历快填</b> 插件</span>
        </div>
        <div class="rqf-step-item">
          <span class="rqf-step-num">3</span>
          <span class="rqf-step-text">点击 <b>"选择简历文件"</b> 上传简历</span>
        </div>
        <div class="rqf-step-item">
          <span class="rqf-step-num">4</span>
          <span class="rqf-step-text">等待解析完成后即可使用快填功能</span>
        </div>
      </div>
      <div class="rqf-dialog-buttons">
        <button class="rqf-dialog-btn rqf-dialog-btn-primary" data-action="close">我知道了</button>
      </div>
    </div>
  `;
  
  dialog.style.cssText = `
    position:fixed;z-index:2147483647;
    top:0;left:0;right:0;bottom:0;
    display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif;
  `;
  
  if (!document.getElementById('rqf-dialog-styles')) {
    const style = document.createElement('style');
    style.id = 'rqf-dialog-styles';
    style.textContent = `
      .rqf-dialog-overlay {
        position:absolute;top:0;left:0;right:0;bottom:0;
        background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);
      }
      .rqf-dialog-content {
        position:relative;
        background:linear-gradient(135deg,#1a1d27 0%,#161925 100%);
        border:2px solid rgba(124,58,237,0.5);
        border-radius:16px;padding:28px 32px;
        min-width:360px;max-width:420px;
        box-shadow:0 20px 60px rgba(0,0,0,0.5),0 0 40px rgba(124,58,237,0.3);
        animation:rqf-dialog-pop 0.3s ease-out;
      }
      @keyframes rqf-dialog-pop {
        from{transform:scale(0.9);opacity:0;}
        to{transform:scale(1);opacity:1;}
      }
      .rqf-dialog-icon {
        font-size:56px;text-align:center;margin-bottom:16px;
        animation:rqf-dialog-bounce 1s ease-in-out infinite;
      }
      @keyframes rqf-dialog-bounce {
        0%,100%{transform:translateY(0);}
        50%{transform:translateY(-8px);}
      }
      .rqf-dialog-title {
        font-size:20px;font-weight:700;color:#a78bfa;
        text-align:center;margin-bottom:12px;
      }
      .rqf-dialog-text {
        font-size:14px;color:#e2e8f0;text-align:center;
        line-height:1.6;margin-bottom:20px;
      }
      .rqf-dialog-steps {
        background:rgba(0,0,0,0.3);border-radius:10px;
        padding:16px;margin-bottom:20px;
      }
      .rqf-step-item {
        display:flex;align-items:center;padding:8px 0;
        border-bottom:1px solid rgba(255,255,255,0.05);
      }
      .rqf-step-item:last-child{border-bottom:none;}
      .rqf-step-num {
        width:24px;height:24px;border-radius:50%;
        background:linear-gradient(135deg,#6c63ff,#a78bfa);
        color:#fff;font-size:12px;font-weight:700;
        display:flex;align-items:center;justify-content:center;
        margin-right:12px;flex-shrink:0;
      }
      .rqf-step-text {
        font-size:13px;color:#e2e8f0;
      }
      .rqf-dialog-buttons {
        display:flex;justify-content:center;gap:12px;
      }
      .rqf-dialog-btn {
        padding:12px 28px;border:none;border-radius:10px;
        font-size:15px;font-weight:600;cursor:pointer;
        font-family:inherit;transition:all 0.2s;
      }
      .rqf-dialog-btn-secondary {
        background:rgba(255,255,255,0.1);color:#e2e8f0;
        border:1px solid rgba(255,255,255,0.2);
      }
      .rqf-dialog-btn-secondary:hover {
        background:rgba(255,255,255,0.15);
      }
      .rqf-dialog-btn-primary {
        background:linear-gradient(135deg,#6c63ff,#a78bfa);
        color:#fff;box-shadow:0 4px 15px rgba(124,58,237,0.4);
      }
      .rqf-dialog-btn-primary:hover {
        transform:translateY(-2px);
        box-shadow:0 6px 20px rgba(124,58,237,0.6);
      }
    `;
    document.head.appendChild(style);
  }
  
  dialog.querySelector('[data-action="close"]').addEventListener('click', () => {
    dialog.remove();
  });
  
  dialog.querySelector('.rqf-dialog-overlay').addEventListener('click', () => {
    dialog.remove();
  });
  
  document.body.appendChild(dialog);
  
  setTimeout(() => {
    if (dialog.parentNode) {
      dialog.remove();
    }
  }, 15000);
}

// ========== 扫描动画效果 ==========
let _scanAnimationRunning = false;
let _scanAnimationElements = [];
let _scanAnimationFrame = null;

function startScanAnimation(fields) {
  if (_scanAnimationRunning) return;
  _scanAnimationRunning = true;
  _scanAnimationElements = [];
  
  const elementMap = window._rqfElementMap || {};
  
  fields.forEach((field, index) => {
    const el = elementMap[field.id];
    if (el) {
      const overlay = document.createElement('div');
      overlay.className = 'rqf-scan-overlay';
      overlay.dataset.fieldId = field.id;
      overlay.style.cssText = [
        'position:fixed',
        'pointer-events:none',
        'z-index:2147483646',
        'border:3px solid transparent',
        'border-radius:6px',
        'transition:border-color 0.4s ease, box-shadow 0.4s ease, background 0.4s ease',
        'background:transparent'
      ].join(';');
      
      const rect = el.getBoundingClientRect();
      overlay.style.left = (rect.left - 4) + 'px';
      overlay.style.top = (rect.top - 4) + 'px';
      overlay.style.width = (rect.width + 8) + 'px';
      overlay.style.height = (rect.height + 8) + 'px';
      
      document.body.appendChild(overlay);
      _scanAnimationElements.push({ overlay, field, el });
    }
  });
  
  function updateOverlayPositions() {
    if (!_scanAnimationRunning) return;
    _scanAnimationElements.forEach(({ overlay, el }) => {
      if (el && overlay.parentNode) {
        const rect = el.getBoundingClientRect();
        overlay.style.left = (rect.left - 4) + 'px';
        overlay.style.top = (rect.top - 4) + 'px';
        overlay.style.width = (rect.width + 8) + 'px';
        overlay.style.height = (rect.height + 8) + 'px';
      }
    });
  }
  
  window.addEventListener('scroll', updateOverlayPositions, true);
  window._scanScrollHandler = updateOverlayPositions;
  
  let currentIndex = 0;
  const totalFields = _scanAnimationElements.length;
  
  function animateNext() {
    if (!_scanAnimationRunning) return;
    
    _scanAnimationElements.forEach(({ overlay }) => {
      overlay.style.borderColor = 'transparent';
      overlay.style.boxShadow = 'none';
      overlay.style.background = 'transparent';
    });
    
    if (currentIndex < totalFields) {
      const { overlay, field, el } = _scanAnimationElements[currentIndex];
      
      const rect = el.getBoundingClientRect();
      overlay.style.left = (rect.left - 4) + 'px';
      overlay.style.top = (rect.top - 4) + 'px';
      overlay.style.width = (rect.width + 8) + 'px';
      overlay.style.height = (rect.height + 8) + 'px';
      
      overlay.style.borderColor = '#7c3aed';
      overlay.style.boxShadow = '0 0 20px rgba(124, 58, 237, 0.6), 0 0 40px rgba(124, 58, 237, 0.3), inset 0 0 10px rgba(124, 58, 237, 0.1)';
      overlay.style.background = 'rgba(124, 58, 237, 0.08)';
      
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      showToast(`🔍 扫描: ${field.hint || '字段 ' + (currentIndex + 1)}`, 'info', 600);
      
      currentIndex++;
      _scanAnimationFrame = setTimeout(animateNext, 600);
    }
  }
  
  animateNext();
}

function stopScanAnimation() {
  _scanAnimationRunning = false;
  if (_scanAnimationFrame) {
    clearTimeout(_scanAnimationFrame);
    _scanAnimationFrame = null;
  }
  if (window._scanScrollHandler) {
    window.removeEventListener('scroll', window._scanScrollHandler, true);
    window._scanScrollHandler = null;
  }
  _scanAnimationElements.forEach(({ overlay }) => {
    if (overlay.parentNode) overlay.remove();
  });
  _scanAnimationElements = [];
}

function highlightFieldScanned(fieldId, success = true) {
  const item = _scanAnimationElements.find(e => e.field.id === fieldId);
  if (item) {
    const { overlay } = item;
    overlay.style.borderColor = success ? '#10b981' : '#f59e0b';
    overlay.style.boxShadow = success 
      ? '0 0 15px rgba(16, 185, 129, 0.6)' 
      : '0 0 15px rgba(245, 158, 11, 0.6)';
    overlay.style.background = success 
      ? 'rgba(16, 185, 129, 0.1)' 
      : 'rgba(245, 158, 11, 0.1)';
    
    setTimeout(() => {
      overlay.style.borderColor = 'transparent';
      overlay.style.boxShadow = 'none';
      overlay.style.background = 'transparent';
    }, 1500);
  }
}

// ========== 获取简历数据 ==========
async function getResume() {
  try {
    const resp = await sendToBackground({ type: 'GET_RESUME' });
    return resp?.ok ? resp.resume : null;
  } catch(e) {
    console.warn('[快填] 获取简历失败:', e.message);
    return null;
  }
}

// ========== 进化系统 ==========
const _autoFilledFields = new Set();
const _isAutoFilling = new Set();
const _observedFields = new Set();
const _fieldValues = new Map();
const _evolutionMemory = {};

const EVOLUTION_BLACKLIST = ['验证码', '密码', '确认密码', 'code', 'password', 'captcha'];
const EVOLUTION_MIN_LENGTH = 1;
const EVOLUTION_MAX_LENGTH = 200;

function isValidEvolutionValue(label, value) {
  if (!label || !value) return false;
  
  const normalizedLabel = label.toLowerCase();
  for (const blackword of EVOLUTION_BLACKLIST) {
    if (normalizedLabel.includes(blackword.toLowerCase())) {
      console.log(`[进化系统] 忽略敏感字段: ${label}`);
      return false;
    }
  }
  
  if (value.length < EVOLUTION_MIN_LENGTH || value.length > EVOLUTION_MAX_LENGTH) {
    console.log(`[进化系统] 值长度不符合要求: ${label} (长度: ${value.length})`);
    return false;
  }
  
  if (/^[\d\s\-_]+$/.test(value) && value.length < 5) {
    console.log(`[进化系统] 忽略纯数字短值: ${label} = ${value}`);
    return false;
  }
  
  return true;
}

async function saveFieldToEvolution(label, section, value) {
  if (!isValidEvolutionValue(label, value)) return;
  
  try {
    const siteKey = getDomain(window.location.href);
    await sendToBackground({ 
      type: 'SAVE_GLOBAL_FIELD_MEMORY', 
      label, 
      section: section || 'basic', 
      value, 
      siteKey 
    });
    console.log(`[进化系统] 成功保存: ${label} = ${value}`);
  } catch(e) {
    console.warn('[进化系统] 保存失败:', e.message);
  }
}

async function getEvolutionMemoryForLLM() {
  try {
    const resp = await sendToBackground({ type: 'GET_ALL_GLOBAL_FIELD_MEMORY' });
    if (resp?.ok && resp.memory) {
      const memory = resp.memory;
      const result = {};
      for (const [key, data] of Object.entries(memory)) {
        if (data.value && data.count >= 1) {
          result[key] = data.value;
        }
      }
      return result;
    }
    return {};
  } catch(e) {
    console.warn('[进化系统] 获取记忆失败:', e.message);
    return {};
  }
}

function markFieldAutoFilled(fieldId) {
  _autoFilledFields.add(fieldId);
}

function isFieldAutoFilled(fieldId) {
  return _autoFilledFields.has(fieldId);
}

function beginAutoFill(fieldId) {
  _isAutoFilling.add(fieldId);
}

function endAutoFill(fieldId) {
  setTimeout(() => {
    _isAutoFilling.delete(fieldId);
  }, 100);
}

function isAutoFilling(fieldId) {
  return _isAutoFilling.has(fieldId);
}

function startFieldChangeObserver(fields) {
  const elementMap = window._rqfElementMap || {};
  
  fields.forEach(field => {
    const el = elementMap[field.id];
    if (el && !_observedFields.has(field.id)) {
      _observedFields.add(field.id);
      
      const initialValue = el.value || '';
      _fieldValues.set(field.id, initialValue);
      
      console.log(`[进化系统] 开始监听字段: ${field.hint}, 初始值: "${initialValue}"`);
      
      const checkChange = () => {
        const currentValue = el.value || '';
        const previousValue = _fieldValues.get(field.id) || '';
        
        if (currentValue && currentValue !== previousValue) {
          if (isAutoFilling(field.id)) {
            console.log(`[进化系统] 自动填充中，更新记录: ${field.hint} = "${currentValue}"`);
            _fieldValues.set(field.id, currentValue);
          } else {
            console.log(`[进化系统] 检测到用户手填: ${field.hint} = "${currentValue}" (之前: "${previousValue}")`);
            if (isValidEvolutionValue(field.hint, currentValue)) {
              saveFieldToEvolution(field.hint, field.section, currentValue);
              showToast(`📝 已记忆: ${field.hint}`, 'success', 2000);
            }
            _fieldValues.set(field.id, currentValue);
          }
        }
      };
      
      el.addEventListener('input', checkChange);
      el.addEventListener('blur', checkChange);
      el.addEventListener('change', checkChange);
    }
  });
  
  console.log(`[进化系统] 已开始监听 ${_observedFields.size} 个字段`);
}

// ========== 日期解析工具 ==========
function parseDate(dateStr) {
  if (!dateStr) return null;
  
  const patterns = [
    /^(\d{4})[年\-\/\.](\d{1,2})[月\-\/\.]?(\d{0,2})/,
    /^(\d{4})\.(\d{1,2})\.?(\d{0,2})/,
    /^(\d{4})\/(\d{1,2})\/?(\d{0,2})/,
    /^(\d{1,2})[月\-\/](\d{4})/,
  ];
  
  for (const pattern of patterns) {
    const match = dateStr.match(pattern);
    if (match) {
      let year, month, day;
      if (pattern === patterns[3]) {
        month = parseInt(match[1]);
        year = parseInt(match[2]);
      } else {
        year = parseInt(match[1]);
        month = parseInt(match[2]);
        day = match[3] ? parseInt(match[3]) : null;
      }
      return { year, month, day };
    }
  }
  
  const yearMatch = dateStr.match(/(\d{4})/);
  if (yearMatch) {
    return { year: parseInt(yearMatch[1]), month: null, day: null };
  }
  
  return null;
}

// ========== 字段扫描 ==========
const IGNORE_KWS = ['搜索','search','查询','筛选','filter','登录','login',
  '注册','register','密码','password','验证码','captcha'];

function shouldIgnoreField(text) {
  const t = text.toLowerCase();
  return IGNORE_KWS.some(k => t.includes(k.toLowerCase()));
}

function scanNearbyTextForKeywords(el) {
  let nearbyText = '';
  
  // 策略1: 查找字段所属的表单组（参考phoenix-select-filler的实现）
  const formItems = document.querySelectorAll('[class*="form-item"], [class*="form-group"], [class*="field-item"], [class*="section"]');
  for (const item of formItems) {
    if (item.contains(el)) {
      const clone = item.cloneNode(true);
      clone.querySelectorAll('input,select,textarea,button,script,style').forEach(e => e.remove());
      const text = clone.textContent;
      nearbyText += ' ' + text;
      
      // 如果找到了关键词，立即停止扫描
      if (text.includes('论文') || text.includes('专著') || text.includes('证书') || text.includes('获奖') || text.includes('荣誉')) {
        break;
      }
    }
  }
  
  // 策略2: 扫描所有父元素，直到找到包含关键词的文本
  let p = el.parentElement;
  for (let i = 0; i < 15 && p; i++) {
    const clone = p.cloneNode(true);
    clone.querySelectorAll('input,select,textarea,button,script,style').forEach(e => e.remove());
    const text = clone.textContent;
    nearbyText += ' ' + text;
    
    // 如果找到了关键词，立即停止扫描
    if (text.includes('论文') || text.includes('专著') || text.includes('证书') || text.includes('获奖') || text.includes('荣誉')) {
      break;
    }
    p = p.parentElement;
  }
  
  // 策略3: 直接在页面中搜索附近的文本（更大范围）
  if (!nearbyText.includes('论文') && !nearbyText.includes('专著') && !nearbyText.includes('证书') && !nearbyText.includes('获奖')) {
    const rect = el.getBoundingClientRect();
    // 搜索多个点，增加找到上下文的概率
    const points = [
      {x: rect.left + 10, y: rect.top - 50},
      {x: rect.left + 10, y: rect.top - 100},
      {x: rect.left + 10, y: rect.top - 150},
      {x: rect.left - 100, y: rect.top + 10},
      {x: rect.left + 100, y: rect.top + 10},
      {x: rect.left + 10, y: rect.top + 50}
    ];
    
    for (const point of points) {
      try {
        const elements = document.elementsFromPoint(point.x, point.y);
        for (const elem of elements) {
          // 优先检查标题元素和标签元素
          if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LABEL', 'SPAN', 'DIV'].includes(elem.tagName)) {
            const elemText = elem.textContent;
            if (elemText.includes('论文') || elemText.includes('专著') || elemText.includes('证书') || elemText.includes('获奖') || elemText.includes('荣誉')) {
              nearbyText += ' ' + elemText;
              break;
            }
          }
        }
      } catch (e) {
        // 忽略坐标无效的错误
      }
    }
  }
  
  // 策略4: 检查兄弟元素（前后都检查）
  let sibling = el.previousElementSibling;
  let siblingCount = 0;
  while (sibling && siblingCount < 8) {
    const siblingText = sibling.textContent;
    if (siblingText.includes('论文') || siblingText.includes('专著') || siblingText.includes('证书') || siblingText.includes('获奖') || siblingText.includes('荣誉')) {
      nearbyText += ' ' + siblingText;
      break;
    }
    sibling = sibling.previousElementSibling;
    siblingCount++;
  }
  
  // 检查后续兄弟元素
  sibling = el.nextElementSibling;
  siblingCount = 0;
  while (sibling && siblingCount < 8) {
    const siblingText = sibling.textContent;
    if (siblingText.includes('论文') || siblingText.includes('专著') || siblingText.includes('证书') || siblingText.includes('获奖') || siblingText.includes('荣誉')) {
      nearbyText += ' ' + siblingText;
      break;
    }
    sibling = sibling.nextElementSibling;
    siblingCount++;
  }
  
  // 策略5: 搜索整个页面中的相关关键词（作为最后手段）
  if (!nearbyText.includes('论文') && !nearbyText.includes('专著') && !nearbyText.includes('证书') && !nearbyText.includes('获奖')) {
    const rect = el.getBoundingClientRect();
    const keywords = ['论文', '专著', '证书', '获奖', '荣誉'];
    for (const keyword of keywords) {
      const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, label, span, div');
      for (const elem of elements) {
        if (elem.textContent.includes(keyword)) {
          // 检查这个元素是否在字段附近
          const elemRect = elem.getBoundingClientRect();
          const distance = Math.sqrt(
            Math.pow(elemRect.left - rect.left, 2) + Math.pow(elemRect.top - rect.top, 2)
          );
          if (distance < 300) {
            nearbyText += ' ' + elem.textContent;
            break;
          }
        }
      }
      if (nearbyText.includes(keyword)) break;
    }
  }
  
  // 只在调试时打印，避免影响性能
  if (IS_DEBUG && (nearbyText.includes('论文') || nearbyText.includes('专著') || nearbyText.includes('证书') || nearbyText.includes('获奖'))) {
    console.log(`[快填] 扫描到附近文本: "${nearbyText.slice(0, 200)}"`);
  }
  return nearbyText;
}

function getFieldLabel(el) {
  let label = '';
  
  // 获取字段标签
  if (el.classList?.contains('phoenix-select')) {
    const formItems = document.querySelectorAll('[class*="form-item"], [class*="form-group"], [class*="field-item"]');
    for (const item of formItems) {
      if (item.querySelector('.phoenix-select') === el) {
        const lbl = item.querySelector('label, .label, [class*="label"]');
        if (lbl) {
          const t = lbl.textContent.trim();
          if (t) { label = t; break; }
        }
      }
    }
  }
  
  if (!label && el.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lbl) { const t = lbl.textContent.trim(); if (t) label = t; }
  }
  
  if (!label) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) label = ariaLabel.trim();
  }
  
  if (!label) {
    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const ref = document.getElementById(ariaLabelledBy);
      if (ref) { const t = ref.textContent.trim(); if (t) label = t; }
    }
  }
  
  if (!label) {
    const pLabel = el.closest('label');
    if (pLabel) {
      const clone = pLabel.cloneNode(true);
      clone.querySelectorAll('input,select,textarea').forEach(e => e.remove());
      const t = clone.textContent.trim();
      if (t) label = t;
    }
  }
  
  if (!label) {
    let prev = el.previousElementSibling;
    for (let i = 0; i < 4 && prev; i++) {
      if (!prev.querySelector('input,select,textarea')) {
        const t = prev.textContent.trim();
        if (t && t.length < 60) { label = t; break; }
      }
      prev = prev.previousElementSibling;
    }
  }
  
  if (!label) {
    let parent = el.parentElement;
    for (let i = 0; i < 7 && parent; i++) {
      const lbl = parent.querySelector(':scope > label, :scope > .label, :scope > .form-label');
      if (lbl && !lbl.contains(el)) {
        const t = lbl.textContent.trim();
        if (t && t.length < 60) { label = t; break; }
      }
      for (const child of parent.children) {
        if (child.contains(el)) continue;
        const cls = child.className || '';
        if (/label|title/i.test(cls)) {
          const t = child.textContent.trim();
          if (t && t.length < 60) { label = t; break; }
        }
      }
      parent = parent.parentElement;
    }
  }
  
  if (!label) {
    label = el.placeholder || el.name || '';
  }
  
  // 基本信息字段直接返回
  const basicFields = ['姓名', '邮箱', '电话', '手机', '性别', '国籍', '特长', '政治面貌', '民族', '籍贯', '户口', '婚否'];
  const labelLower = label.toLowerCase();
  if (basicFields.some(basic => labelLower.includes(basic.toLowerCase()))) {
    return label;
  }
  
  // 高级上下文检测 - 向上查找包含标题的容器
  let context = '';
  let current = el.parentElement;
  let level = 0;
  
  while (current && level < 15) {
    // 检查当前元素是否包含明确的标题
    const headings = current.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="header"], [class*="section"]');
    for (const heading of headings) {
      const headingText = heading.textContent.trim();
      if (headingText) {
        context = headingText;
        break;
      }
    }
    
    if (context) break;
    current = current.parentElement;
    level++;
  }
  
  // 基于上下文确定字段类型
  const contextLower = context.toLowerCase();
  
  if (contextLower.includes('论文') || contextLower.includes('专著')) {
    return `论文/专著 - ${label}`;
  } else if (contextLower.includes('证书')) {
    return `证书 - ${label}`;
  } else if (contextLower.includes('获奖') || contextLower.includes('荣誉') || contextLower.includes('奖项')) {
    return `获奖 - ${label}`;
  } else if (contextLower.includes('项目')) {
    return `项目 - ${label}`;
  } else if (contextLower.includes('实习') || contextLower.includes('工作')) {
    return `实习 - ${label}`;
  } else if (contextLower.includes('教育')) {
    return `教育 - ${label}`;
  } else if (contextLower.includes('技能')) {
    return `技能 - ${label}`;
  } else if (contextLower.includes('课程')) {
    return `课程 - ${label}`;
  }
  
  // 基于字段标签本身的关键词
  if (labelLower.includes('论文') || labelLower.includes('专著')) {
    return `论文/专著 - ${label}`;
  } else if (labelLower.includes('证书') || labelLower.includes('资格证') || 
             labelLower.includes('职业技能') || labelLower.includes('资质证书')) {
    return `证书 - ${label}`;
  } else if (labelLower.includes('获奖') || labelLower.includes('荣誉') || labelLower.includes('奖项')) {
    return `获奖 - ${label}`;
  } else if (labelLower.includes('项目') || labelLower.includes('project')) {
    return `项目 - ${label}`;
  } else if (labelLower.includes('实习') || labelLower.includes('工作') || labelLower.includes('work')) {
    return `实习 - ${label}`;
  } else if (labelLower.includes('教育') || labelLower.includes('学校') || labelLower.includes('edu')) {
    return `教育 - ${label}`;
  } else if (labelLower.includes('技能') || labelLower.includes('技术栈')) {
    return `技能 - ${label}`;
  } else if (labelLower.includes('课程') || labelLower.includes('主修')) {
    return `课程 - ${label}`;
  }
  
  // 额外的上下文检测：搜索更广泛的区域
  if (label === '名称' || label === 'name' || label === '') {
    // 搜索更大范围的上下文
    let searchParent = el.parentElement;
    let searchLevel = 0;
    while (searchParent && searchLevel < 20) {
      const searchText = searchParent.textContent.toLowerCase();
      if (searchText.includes('证书')) {
        return `证书 - ${label}`;
      } else if (searchText.includes('获奖') || searchText.includes('荣誉')) {
        return `获奖 - ${label}`;
      } else if (searchText.includes('论文') || searchText.includes('专著')) {
        return `论文/专著 - ${label}`;
      } else if (searchText.includes('项目')) {
        return `项目 - ${label}`;
      }
      searchParent = searchParent.parentElement;
      searchLevel++;
    }
  }
  
  return label;
}

function getUniqueSelector(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  if (el.name && document.querySelectorAll(`[name="${CSS.escape(el.name)}"]`).length === 1)
    return `[name="${CSS.escape(el.name)}"]`;
  const path = [];
  let cur = el;
  while (cur && cur !== document.body && path.length < 8) {
    let seg = cur.tagName.toLowerCase();
    if (cur.id) { seg = '#' + CSS.escape(cur.id); path.unshift(seg); break; }
    const siblings = cur.parentElement
      ? Array.from(cur.parentElement.children).filter(c => c.tagName === cur.tagName)
      : [];
    if (siblings.length > 1) seg += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
    path.unshift(seg);
    cur = cur.parentElement;
  }
  return path.join(' > ');
}

function detectSection(el, label = '', ctx = '') {
  const EDU_KWS   = ['教育','学习经历','学历','学校','edu','教育背景'];
  const WORK_KWS  = ['工作','实习','工作经历','实习经历','work','intern','工作背景','实践经历'];
  const PROJ_KWS  = ['项目','project','项目经历','项目经验'];
  const AWARD_KWS = ['获奖','荣誉','award','honor'];
  const CERT_KWS  = ['证书','资格证','职业技能','资质证书','certificate'];
  const LANG_KWS  = ['语言','language'];
  const SKILL_KWS = ['技能','skill','专业技能','技能特长','技术栈'];
  const COURSE_KWS = ['课程','course','主修课程','所学课程'];
  const THESIS_KWS = ['论文','专著','publication','thesis'];
  
  // 首先根据 label 和 ctx 进行二次判断
  const labelLower = (label || '').toLowerCase();
  const ctxLower = (ctx || '').toLowerCase();
  
  // 优先级最高的判断：根据 label 和 ctx
  if (THESIS_KWS.some(k => labelLower.includes(k) || ctxLower.includes(k))) return 'thesis';
  if (CERT_KWS.some(k => labelLower.includes(k) || ctxLower.includes(k))) return 'certificate';
  if (AWARD_KWS.some(k => labelLower.includes(k) || ctxLower.includes(k))) return 'award';
  if (PROJ_KWS.some(k => labelLower.includes(k) || ctxLower.includes(k))) return 'project';
  if (WORK_KWS.some(k => labelLower.includes(k) || ctxLower.includes(k))) return 'work';
  if (EDU_KWS.some(k => labelLower.includes(k) || ctxLower.includes(k))) return 'education';
  if (COURSE_KWS.some(k => labelLower.includes(k) || ctxLower.includes(k))) return 'course';
  if (SKILL_KWS.some(k => labelLower.includes(k) || ctxLower.includes(k))) return 'skill';
  if (LANG_KWS.some(k => labelLower.includes(k) || ctxLower.includes(k))) return 'lang';
  
  // 然后根据 DOM 结构判断
  let p = el.parentElement;
  for (let i = 0; i < 12 && p; i++) {
    const heading = p.querySelector('h2,h3,h4,legend,[class*="section-title"],[class*="group-title"]');
    const txt = [
      p.getAttribute('data-section') || '',
      p.getAttribute('data-type') || '',
      heading ? heading.textContent : '',
      p.className || ''
    ].join(' ').toLowerCase();
    
    if (THESIS_KWS.some(k => txt.includes(k))) return 'thesis';
    if (CERT_KWS.some(k => txt.includes(k))) return 'certificate';
    if (COURSE_KWS.some(k => txt.includes(k))) return 'course';
    if (SKILL_KWS.some(k => txt.includes(k))) return 'skill';
    if (EDU_KWS.some(k => txt.includes(k))) return 'education';
    if (WORK_KWS.some(k => txt.includes(k))) return 'work';
    if (PROJ_KWS.some(k => txt.includes(k))) return 'project';
    if (AWARD_KWS.some(k => txt.includes(k))) return 'award';
    if (LANG_KWS.some(k => txt.includes(k))) return 'lang';
    p = p.parentElement;
  }
  return 'basic';
}

function getFieldCtx(el) {
  const parent = el.parentElement;
  if (!parent) return '';
  const clone = parent.cloneNode(true);
  clone.querySelectorAll('script,style,svg,img').forEach(e => e.remove());
  return clone.textContent.replace(/\s+/g,' ').trim().slice(0, 300);
}

function detectDatePicker(el) {
  const className = (el.className || '').toLowerCase();
  const parentClass = (el.parentElement?.className || '').toLowerCase();
  const grandParentClass = (el.parentElement?.parentElement?.className || '').toLowerCase();
  
  const datePickerPatterns = [
    'date-picker', 'datepicker', 'el-date-editor', 'ant-picker',
    'el-input__inner', 'date', 'calendar', 'picker', 'datetime',
    'phoenix-date', 'time-picker'
  ];
  
  const combined = className + ' ' + parentClass + ' ' + grandParentClass;
  if (datePickerPatterns.some(p => combined.includes(p))) {
    return true;
  }
  
  if (el.type === 'date' || el.type === 'datetime-local' || el.type === 'month') {
    return true;
  }
  
  const placeholder = (el.placeholder || '').toLowerCase();
  if (placeholder.includes('日期') || placeholder.includes('时间') || 
      placeholder.includes('年') || placeholder.includes('月') ||
      placeholder.includes('date') || placeholder.includes('time')) {
    return true;
  }
  
  return false;
}

async function scanFields() {
  const fields = [];
  let idCounter = 0;
  const elementMap = {};

  // 1. 原生 input / textarea
  const nativeEls = document.querySelectorAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file])' +
    ':not([type=reset]):not([type=image]):not([accept]):not([disabled]), textarea:not([disabled])'
  );
  for (const el of nativeEls) {
    if (el.type === 'file' || el.hasAttribute('accept')) continue;
    
    const classIdName = (el.className + ' ' + el.id + ' ' + el.name).toLowerCase();
    if (/upload|file|attachment|证件|照片|头像|图片/i.test(classIdName)) continue;
    
    let p = el.parentElement;
    for (let i = 0; i < 5 && p; i++) {
      const pClass = (p.className + ' ' + p.id).toLowerCase();
      if (/upload|file|attachment/i.test(pClass)) { el = null; break; }
      p = p.parentElement;
    }
    if (!el) continue;
    
    const label = getFieldLabel(el);
    const ph = el.placeholder || '';
    if (/上传|upload|file|选择文件|证件|照片|头像/i.test(label + ' ' + ph)) continue;
    
    if (shouldIgnoreField(label + ' ' + ph)) continue;
    if (!label && !ph && (!el.name || el.name.length < 2)) continue;
    if (el.value && el.value.trim() && el.tagName !== 'TEXTAREA') continue;
    
    const id = 'f' + (idCounter++);
    el.dataset.rqfId = id;
    elementMap[id] = el;
    
    const isDatePicker = detectDatePicker(el);
    const ctx = getFieldCtx(el);
    const section = detectSection(el, label, ctx);
    
    fields.push({
      id,
      type: isDatePicker ? 'date-picker' : (el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text')),
      hint: (label || ph).slice(0, 60),
      labels: [label],
      placeholder: ph,
      options: [],
      section,
      ctx,
      selector: getUniqueSelector(el),
      isDatePicker
    });
  }

  // 2. 原生 select
  for (const el of document.querySelectorAll('select:not([disabled])')) {
    const label = getFieldLabel(el);
    if (shouldIgnoreField(label)) continue;
    const opts = Array.from(el.options)
      .map(o => o.text.trim())
      .filter(t => t && t !== '请选择' && t !== '--' && t !== '选择');
    const id = 'f' + (idCounter++);
    el.dataset.rqfId = id;
    elementMap[id] = el;
    const ctx = getFieldCtx(el);
    fields.push({
      id, type: 'select',
      hint: (label || el.name || '').slice(0, 60),
      labels: [label],
      placeholder: '', options: opts.slice(0, 40),
      section: detectSection(el, label, ctx),
      ctx,
      selector: getUniqueSelector(el)
    });
  }

  // 3. radio 组
  const radioGroups = {};
  for (const el of document.querySelectorAll('input[type=radio]:not([disabled])')) {
    const gname = el.name || ('radio_' + idCounter);
    if (!radioGroups[gname]) {
      const label = getFieldLabel(el);
      const id = 'f' + (idCounter++);
      const ctx = getFieldCtx(el);
      radioGroups[gname] = {
        id, type: 'radio',
        hint: (label || gname).slice(0, 60),
        labels: [label],
        placeholder: '', options: [],
        section: detectSection(el, label, ctx),
        ctx,
        selector: `input[type=radio][name="${CSS.escape(gname)}"]`,
        _radioName: gname,
        _firstEl: el
      };
      elementMap[id] = el;
    }
    const lbl = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const optText = lbl ? lbl.textContent.trim() : (el.value || '');
    if (optText && !radioGroups[gname].options.includes(optText))
      radioGroups[gname].options.push(optText);
  }
  for (const g of Object.values(radioGroups)) {
    if (!shouldIgnoreField(g.hint)) fields.push(g);
  }

  // 4. 自定义下拉框
  const CUSTOM_SEL = [
    '.el-select','.ant-select','.phoenix-select',
    '.n-select','.ivu-select',
    '[class*="Select__container"]','[class*="select-box"]',
    '[data-role="select"]'
  ];
  const seenCustom = new Set();
  for (const el of document.querySelectorAll(CUSTOM_SEL.join(','))) {
    if (el.tagName === 'SELECT' || seenCustom.has(el)) continue;
    if (el.querySelector('select:not([disabled])')) continue;
    seenCustom.add(el);
    const input = el.querySelector('input');
    const label = getFieldLabel(input || el);
    const ph = input?.placeholder || el.getAttribute('placeholder') || '';
    if (shouldIgnoreField(label + ' ' + ph)) continue;
    if (!label && !ph) continue;
    const id = 'f' + (idCounter++);
    el.dataset.rqfId = id;
    elementMap[id] = el;
    const staticOpts = Array.from(
      el.querySelectorAll('[role=option],[class*="option"],[class*="item"]')
    ).map(o => o.textContent.trim()).filter(t => t && t.length < 40);
    const ctx = getFieldCtx(el);
    fields.push({
      id, type: 'custom-select',
      hint: (label || ph).slice(0, 60),
      labels: [label],
      placeholder: ph, options: staticOpts.slice(0, 40),
      section: detectSection(el, label, ctx),
      ctx,
      selector: getUniqueSelector(el)
    });
  }

  // 5. 日期选择器容器（Element UI, Ant Design, Phoenix 等）
  const DATE_PICKER_SEL = [
    '.el-date-editor', '.ant-picker', '.phoenix-date-picker',
    '[class*="date-picker"]', '[class*="datepicker"]',
    '[class*="DatePicker"]'
  ];
  for (const el of document.querySelectorAll(DATE_PICKER_SEL.join(','))) {
    if (el.dataset.rqfId) continue;
    const input = el.querySelector('input');
    if (!input) continue;
    
    const label = getFieldLabel(el);
    const ph = input.placeholder || '';
    if (shouldIgnoreField(label + ' ' + ph)) continue;
    
    const id = 'f' + (idCounter++);
    el.dataset.rqfId = id;
    elementMap[id] = el;
    const ctx = getFieldCtx(el);
    
    fields.push({
      id, type: 'date-picker',
      hint: (label || ph).slice(0, 60),
      labels: [label],
      placeholder: ph,
      options: [],
      section: detectSection(el, label, ctx),
      ctx,
      selector: getUniqueSelector(el)
    });
  }

  if (IS_DEBUG) console.log(`[快填] 扫描到 ${fields.length} 个字段`, fields);
  
  window._rqfElementMap = elementMap;
  
  return fields;
}

// ========== 执行填写核心 ==========

function triggerReactiveUpdate(el, value) {
  el.focus();
  el.dispatchEvent(new Event('focus', { bubbles: true }));

  const nIS = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  const nTS = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (el.tagName === 'TEXTAREA' && nTS) nTS.call(el, value);
  else if (nIS) nIS.call(el, value);
  else el.value = value;

  el.dispatchEvent(new Event('input',   { bubbles: true, cancelable: true }));
  el.dispatchEvent(new Event('change',  { bubbles: true, cancelable: true }));
  el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: value.slice(-1) || 'a' }));
  el.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true, cancelable: true, key: value.slice(-1) || 'a' }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function highlightField(el) {
  el.style.outline = '2px solid #22c55e';
  el.style.outlineOffset = '1px';
  setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 3000);
}

// ========== 通用组件处理器（从配置读取） ==========
let _componentHandlers = null;

async function loadComponentHandlers() {
  if (_componentHandlers) return _componentHandlers;
  try {
    const resp = await sendToBackground({ type: 'GET_SITE_RULES' });
    if (resp?.ok && resp.rules?.component_handlers) {
      _componentHandlers = resp.rules.component_handlers;
      return _componentHandlers;
    }
  } catch(e) {
    console.warn('[快填] 加载组件处理器配置失败:', e);
  }
  return null;
}

async function fillDatePickerWithConfig(el, value, fieldId) {
  const handlers = await loadComponentHandlers();
  const domain = getDomain(window.location.href);
  
  let config = handlers?.date_picker?.default || {};
  if (handlers?.site_specific?.[domain]?.component_handlers?.date_picker) {
    config = { ...config, ...handlers.site_specific[domain].component_handlers.date_picker };
  }
  
  const triggerSelectors = config.trigger_selectors || [
    ".el-date-editor", ".ant-picker", "[class*='date-picker']"
  ];
  
  const parsed = parseDate(value);
  if (!parsed) return false;
  
  const { year, month, day } = parsed;
  
  const input = el.tagName === 'INPUT' ? el : el.querySelector('input');
  if (input) {
    const formats = [
      value,
      `${year}-${String(month).padStart(2, '0')}-${String(day || 1).padStart(2, '0')}`,
      `${year}/${String(month).padStart(2, '0')}/${String(day || 1).padStart(2, '0')}`,
      `${year}.${String(month).padStart(2, '0')}.${String(day || 1).padStart(2, '0')}`,
      `${year}年${month}月${day ? day + '日' : ''}`,
    ].filter(Boolean);
    
    for (const fmt of formats) {
      triggerReactiveUpdate(input, fmt);
      await sleep(100);
      if (input.value) {
        highlightField(el);
        return true;
      }
    }
  }
  
  return await fillDatePicker(el, value, fieldId);
}

async function fillCustomSelectWithConfig(el, value, fieldId) {
  const handlers = await loadComponentHandlers();
  const domain = getDomain(window.location.href);
  
  let config = handlers?.custom_select?.default || {};
  if (handlers?.site_specific?.[domain]?.component_handlers?.custom_select) {
    config = { ...config, ...handlers.site_specific[domain].component_handlers.custom_select };
  }
  
  const triggerSelectors = config.trigger_selectors || [".el-select", ".ant-select"];
  const optionSelector = config.option_selector || ".el-select-dropdown__item, .ant-select-item";
  
  el.click();
  await sleep(200);
  
  const dropdown = document.querySelector(config.dropdown_selectors?.join(',') || '.el-select-dropdown, .ant-select-dropdown');
  if (!dropdown) {
    return await fillCustomSelect(el, value, fieldId);
  }
  
  const options = dropdown.querySelectorAll(optionSelector);
  const normalizedValue = normalizeText(value);
  
  for (const opt of options) {
    const optText = normalizeText(opt.textContent || '');
    if (optText === normalizedValue || optText.includes(normalizedValue) || normalizedValue.includes(optText)) {
      opt.click();
      await sleep(100);
      highlightField(el);
      return true;
    }
  }
  
  return await fillCustomSelect(el, value, fieldId);
}

// ========== 日期选择器专门处理 ==========
async function fillDatePicker(el, value, fieldId) {
  if (IS_DEBUG) console.log(`[快填] #${fieldId || 'unknown'} 日期选择器，目标="${value}"`);
  
  const parsed = parseDate(value);
  if (!parsed) {
    console.warn(`[快填] #${fieldId} 无法解析日期: ${value}`);
    return false;
  }
  
  const { year, month, day } = parsed;
  
  // 策略1：尝试直接填写 input（适用于所有类型的日期输入）
  const input = el.tagName === 'INPUT' ? el : el.querySelector('input');
  if (input) {
    // 尝试多种日期格式
    const formats = [
      value, // 原始格式
      `${year}-${String(month).padStart(2, '0')}-${String(day || 1).padStart(2, '0')}`, // 2024-09-01
      `${year}/${String(month).padStart(2, '0')}/${String(day || 1).padStart(2, '0')}`, // 2024/09/01
      `${year}.${String(month).padStart(2, '0')}.${String(day || 1).padStart(2, '0')}`, // 2024.09.01
      `${year}年${month}月${day ? day + '日' : ''}`, // 2024年9月1日
      `${year}-${String(month).padStart(2, '0')}`, // 2024-09
      `${year}.${String(month).padStart(2, '0')}`, // 2024.09
    ].filter(Boolean);
    
    for (const fmt of formats) {
      if (IS_DEBUG) console.log(`[快填] #${fieldId} 尝试格式: ${fmt}`);
      
      // 使用更强大的输入方法
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(input, fmt);
      
      // 触发所有必要的事件
      input.dispatchEvent(new Event('focus', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter' }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      
      await sleep(500);
      
      // 检查是否填写成功
      if (input.value && input.value.trim()) {
        highlightField(el);
        if (IS_DEBUG) console.log(`[快填] #${fieldId} 日期填写成功: ${input.value}`);
        return true;
      }
    }
  }
  
  // 策略2：Element UI 日期选择器
  if (el.classList.contains('el-date-editor') || el.closest('.el-date-editor')) {
    const pickerEl = el.classList.contains('el-date-editor') ? el : el.closest('.el-date-editor');
    const pickerInput = pickerEl.querySelector('input');
    
    if (pickerInput) {
      pickerInput.click();
      await sleep(300);
      
      const panel = document.querySelector('.el-picker-panel, .el-date-picker');
      if (panel) {
        // 选择年份
        const yearBtn = panel.querySelector('.el-date-picker__header-label, .el-picker-panel__icon-btn');
        if (yearBtn) {
          // 点击年份选择器
          const headerLabels = panel.querySelectorAll('.el-date-picker__header-label');
          for (const label of headerLabels) {
            if (label.textContent.includes('年')) {
              label.click();
              await sleep(200);
              
              // 选择年份
              const yearItems = panel.querySelectorAll('.el-year-table td');
              for (const item of yearItems) {
                if (item.textContent.includes(year.toString())) {
                  item.click();
                  await sleep(200);
                  break;
                }
              }
              break;
            }
          }
          
          // 选择月份
          const monthItems = panel.querySelectorAll('.el-month-table td');
          for (const item of monthItems) {
            const monthText = item.textContent.trim();
            const monthNum = parseInt(monthText.replace('月', ''));
            if (monthNum === month) {
              item.click();
              await sleep(200);
              break;
            }
          }
          
          // 选择日期
          if (day) {
            const dateItems = panel.querySelectorAll('.el-date-table td.available');
            for (const item of dateItems) {
              if (item.textContent.trim() === day.toString()) {
                item.click();
                await sleep(100);
                break;
              }
            }
          }
        }
        
        highlightField(pickerEl);
        return true;
      }
    }
  }
  
  // 策略3：Ant Design 日期选择器
  if (el.classList.contains('ant-picker') || el.closest('.ant-picker')) {
    const pickerEl = el.classList.contains('ant-picker') ? el : el.closest('.ant-picker');
    const pickerInput = pickerEl.querySelector('input');
    
    if (pickerInput) {
      pickerInput.click();
      await sleep(300);
      
      const dropdown = document.querySelector('.ant-picker-dropdown');
      if (dropdown) {
        // 选择年份和月份
        const yearSelect = dropdown.querySelector('.ant-picker-year-btn, [title*="年"]');
        if (yearSelect) {
          yearSelect.click();
          await sleep(200);
          
          const yearItems = dropdown.querySelectorAll('.ant-picker-cell');
          for (const item of yearItems) {
            if (item.textContent.includes(year.toString())) {
              item.click();
              await sleep(200);
              break;
            }
          }
        }
        
        const monthSelect = dropdown.querySelector('.ant-picker-month-btn, [title*="月"]');
        if (monthSelect) {
          monthSelect.click();
          await sleep(200);
          
          const monthItems = dropdown.querySelectorAll('.ant-picker-cell');
          for (const item of monthItems) {
            const monthText = item.textContent.trim();
            const monthNum = parseInt(monthText);
            if (monthNum === month) {
              item.click();
              await sleep(200);
              break;
            }
          }
        }
        
        // 选择日期
        if (day) {
          const dateItems = dropdown.querySelectorAll('.ant-picker-cell');
          for (const item of dateItems) {
            if (item.textContent.trim() === day.toString() && !item.classList.contains('ant-picker-cell-disabled')) {
              item.click();
              await sleep(100);
              break;
            }
          }
        }
        
        highlightField(pickerEl);
        return true;
      }
    }
  }
  
  // 策略4：Phoenix 日期选择器
  if (el.classList.contains('phoenix-date-picker') || el.closest('.phoenix-date-picker')) {
    const pickerEl = el.classList.contains('phoenix-date-picker') ? el : el.closest('.phoenix-date-picker');
    const pickerInput = pickerEl.querySelector('input');
    
    if (pickerInput) {
      pickerInput.click();
      await sleep(400);
      
      // Phoenix 日期选择器面板
      const panel = document.querySelector('.phoenix-date-picker-panel, [class*="date-picker-dropdown"]');
      if (panel) {
        // 选择年份
        const yearSelector = panel.querySelector('[class*="year-selector"], .phoenix-date-picker__year-btn');
        if (yearSelector) {
          yearSelector.click();
          await sleep(200);
          
          const yearItems = panel.querySelectorAll('[class*="year-item"], td');
          for (const item of yearItems) {
            if (item.textContent.includes(year.toString())) {
              item.click();
              await sleep(200);
              break;
            }
          }
        }
        
        // 选择月份
        const monthItems = panel.querySelectorAll('[class*="month-item"], td');
        for (const item of monthItems) {
          const monthText = item.textContent.trim();
          if (monthText === `${month}月` || monthText === String(month)) {
            item.click();
            await sleep(200);
            break;
          }
        }
        
        // 选择日期
        if (day) {
          const dateItems = panel.querySelectorAll('[class*="date-item"], td:not([class*="disabled"])');
          for (const item of dateItems) {
            if (item.textContent.trim() === day.toString()) {
              item.click();
              await sleep(100);
              break;
            }
          }
        }
        
        highlightField(pickerEl);
        return true;
      }
    }
  }
  
  console.warn(`[快填] #${fieldId} 日期选择器填写失败`);
  return false;
}

function getVisibleOptions() {
  const SELS = [
    '[role="option"]','.el-select-dropdown__item',
    '.ant-select-item','.ant-select-item-option-content',
    '.ivu-select-item','.n-base-select-option','.phoenix-select__option',
    'li[class*="option"]','li[class*="item"]','div[class*="option-item"]',
    '[class*="popper"] li','[class*="dropdown"] [class*="item"]'
  ];
  for (const sel of SELS) {
    const opts = Array.from(document.querySelectorAll(sel))
      .filter(o => o.offsetParent !== null && o.textContent.trim().length > 0);
    if (opts.length > 0) return opts;
  }
  return [];
}

function normalizeText(t) {
  return t.toLowerCase().replace(/[\s\u3000]+/g, ' ').trim();
}

function findBestOption(opts, target) {
  const nt = normalizeText(target);
  for (const o of opts) { if (normalizeText(o.textContent) === nt) return o; }
  for (const o of opts) {
    const no = normalizeText(o.textContent);
    if (no.includes(nt) || nt.includes(no)) return o;
  }
  return null;
}

function waitForOptions(timeoutMs = 2500) {
  return new Promise(resolve => {
    const check = () => { const o = getVisibleOptions(); return o.length > 0 ? o : null; };
    const found = check();
    if (found) { resolve(found); return; }
    const ob = new MutationObserver(() => {
      const o = check();
      if (o) { ob.disconnect(); clearTimeout(tid); resolve(o); }
    });
    ob.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style','class'] });
    const tid = setTimeout(() => { ob.disconnect(); resolve(check() || []); }, timeoutMs);
  });
}

async function fillCustomSelect(el, value, fieldId) {
  if (IS_DEBUG) console.log(`[快填] #${fieldId} custom-select, 目标="${value}"`);
  
  if (el.classList.contains('phoenix-select')) {
    const trigger = el.querySelector('.phoenix-select__placeHolder, .phoenix-select__switchArrow') || el;
    trigger.click();
    await sleep(600);
    
    const opts = await waitForOptions(2000);
    if (opts.length > 0) {
      const best = findBestOption(opts, value);
      if (best) {
        best.click();
        await sleep(200);
        if (IS_DEBUG) console.log(`[快填] #${fieldId} phoenix-select 选中: "${best.textContent.trim()}"`);
        return true;
      }
    }
    
    const input = el.querySelector('.phoenix-select__input');
    if (input) {
      triggerReactiveUpdate(input, value);
      await sleep(500);
      const opts2 = getVisibleOptions();
      const best2 = findBestOption(opts2, value);
      if (best2) {
        best2.click();
        await sleep(200);
        if (IS_DEBUG) console.log(`[快填] #${fieldId} phoenix-select 搜索选中: "${best2.textContent.trim()}"`);
        return true;
      }
    }
    
    document.body.click();
    await sleep(100);
    return false;
  }
  
  const expandStrategies = [
    () => { el.click(); },
    () => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); },
    () => { const inp = el.querySelector('input'); if (inp) { inp.focus(); inp.click(); } else el.focus(); }
  ];
  
  for (const strategy of expandStrategies) {
    try { strategy(); } catch(e) {}
    const opts = await waitForOptions(1500);
    if (opts.length > 0) {
      const best = findBestOption(opts, value);
      if (best) {
        best.click();
        await sleep(150);
        if (IS_DEBUG) console.log(`[快填] #${fieldId} 自定义下拉框选中: "${best.textContent.trim()}"`);
        return true;
      }
      const inp = el.querySelector('input');
      if (inp) {
        triggerReactiveUpdate(inp, value);
        await sleep(400);
        const opts2 = getVisibleOptions();
        const best2 = findBestOption(opts2, value);
        if (best2) { best2.click(); await sleep(150); return true; }
      }
      document.body.click();
      await sleep(100);
      break;
    }
  }
  
  const inp = el.querySelector('input');
  if (inp) { triggerReactiveUpdate(inp, value); return true; }
  return false;
}

async function fillRadio(radioName, value, fieldId) {
  const radios = document.querySelectorAll(`input[type=radio][name="${CSS.escape(radioName)}"]`);
  const nv = normalizeText(value);
  for (const radio of radios) {
    const lbl = radio.id ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`) : null;
    const txt = normalizeText(lbl ? lbl.textContent : (radio.value || ''));
    if (txt === nv || txt.includes(nv) || nv.includes(txt)) {
      radio.click();
      highlightField(radio);
      if (IS_DEBUG) console.log(`[快填] #${fieldId} radio 选中: "${txt}"`);
      return true;
    }
  }
  return false;
}

async function applyPlan(fields, plan, resume) {
  let filled = 0;
  const elementMap = window._rqfElementMap || {};
  
  // 后处理验证：检查证书是否被错误填入获奖字段
  const validateAndFix = (field, value) => {
    // 如果字段是获奖分区，但值包含证书关键词
    if (field.section === 'award' || field.hint.includes('获奖') || field.hint.includes('荣誉')) {
      const certKeywords = ['证书', 'CET', '四级', '六级', '计算机', '职业技能', '资格证'];
      const isCertValue = certKeywords.some(k => value.includes(k));
      
      // 检查简历中是否有对应的获奖信息
      const hasMatchingAward = resume?.awards?.some(a => 
        a.name === value || a.title === value || (a.name && value.includes(a.name))
      );
      
      if (isCertValue && !hasMatchingAward) {
        console.warn(`[快填] 后处理验证: 字段 #${field.id} "${field.hint}" 是获奖字段，但值 "${value}" 是证书信息，已跳过`);
        return null;
      }
    }
    
    // 如果字段是论文/专著分区，直接跳过
    if (field.section === 'thesis' || field.hint.includes('论文') || field.hint.includes('专著')) {
      console.warn(`[快填] 后处理验证: 字段 #${field.id} "${field.hint}" 是论文/专著字段，已跳过`);
      return null;
    }
    
    return value;
  };
  
  for (const field of fields) {
    const entry = plan[field.id];
    if (!entry || entry.value == null || entry.value === '') continue;
    
    // 后处理验证
    const validatedValue = validateAndFix(field, String(entry.value));
    if (validatedValue === null) continue;
    
    const value = validatedValue;
    if (IS_DEBUG) console.log(`[快填] 填写 #${field.id} [${field.hint}] = "${value.slice(0,40)}"`);
    try {
      let el = elementMap[field.id];
      if (!el) {
        console.warn(`[快填] #${field.id} 元素引用丢失，尝试用 selector 查询`);
        el = document.querySelector(field.selector);
      }
      if (!el) { console.warn(`[快填] #${field.id} 找不到元素`); continue; }
      
      // 检查是否是 Phoenix 选择器 - 如果是，跳过，让 phoenix-select-filler 处理
      const isPhoenixSelect = el && (
        (el.classList && el.classList.contains('phoenix-select')) || 
        el.querySelector('.phoenix-select')
      );
      
      if (isPhoenixSelect) {
        console.log(`[快填] #${field.id} 是 Phoenix 选择器，跳过，让 phoenix-select-filler 处理`);
        continue;
      }
      
      if (field.type === 'date-picker') {
        beginAutoFill(field.id);
        const ok = await fillDatePicker(el, value, field.id);
        endAutoFill(field.id);
        if (ok) { markFieldAutoFilled(field.id); filled++; }
      } else if (field.type === 'radio') {
        beginAutoFill(field.id);
        const ok = await fillRadio(field._radioName || field.hint, value, field.id);
        endAutoFill(field.id);
        if (ok) { markFieldAutoFilled(field.id); filled++; }
      } else if (field.type === 'custom-select') {
        beginAutoFill(field.id);
        const ok = await fillCustomSelect(el, value, field.id);
        endAutoFill(field.id);
        if (ok) { markFieldAutoFilled(field.id); highlightField(el); filled++; }
      } else if (field.type === 'select') {
        const opts = Array.from(el.options);
        const best = opts.find(o => normalizeText(o.text) === normalizeText(value)) ||
                     opts.find(o => { const n = normalizeText(o.text); return n.includes(normalizeText(value)) || normalizeText(value).includes(n); });
        if (best) {
          beginAutoFill(field.id);
          el.value = best.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          endAutoFill(field.id);
          markFieldAutoFilled(field.id);
          highlightField(el);
          filled++;
          if (IS_DEBUG) console.log(`[快填] select 选中: "${best.text}"`);
        }
      } else {
        if (el.type === 'file' || el.hasAttribute('accept')) {
          console.warn(`[快填] #${field.id} 跳过 file input: ${field.hint}`);
          continue;
        }
        beginAutoFill(field.id);
        triggerReactiveUpdate(el, value);
        endAutoFill(field.id);
        markFieldAutoFilled(field.id);
        highlightField(el);
        filled++;
      }
      await sleep(80);
    } catch(e) {
      console.warn(`[快填] 填写 #${field.id} 失败:`, e.message);
    }
  }
  return filled;
}

// ========== 主填充流程 ==========

let _filling = false;

function collectFormDOM() {
  const formData = {
    url: window.location.href,
    timestamp: new Date().toISOString(),
    selects: [],
    customSelects: [],
    datePickers: [],
    timePickers: [],
    cascaders: [],
    textInputs: [],
    textareas: [],
    radios: [],
    checkboxes: []
  };

  document.querySelectorAll('select').forEach((el, i) => {
    const label = getFieldLabel(el);
    const options = Array.from(el.options).map(o => o.text.trim());
    formData.selects.push({
      index: i,
      label,
      name: el.name,
      id: el.id,
      className: el.className,
      options: options.slice(0, 10),
      html: el.outerHTML.slice(0, 500)
    });
  });

  const customSelectors = ['.el-select', '.ant-select', '.phoenix-select', '.n-select', '.ivu-select'];
  document.querySelectorAll(customSelectors.join(',')).forEach((el, i) => {
    const input = el.querySelector('input');
    const label = getFieldLabel(input || el);
    
    let parentLabel = '';
    let p = el.parentElement;
    for (let j = 0; j < 3 && p; j++) {
      const lbl = p.querySelector('label, .label, [class*="label"]');
      if (lbl && !lbl.contains(el)) {
        parentLabel = lbl.textContent.trim();
        break;
      }
      p = p.parentElement;
    }
    
    const className = el.className;
    const options = Array.from(el.querySelectorAll('[role=option],[class*="option"]'))
      .map(o => o.textContent.trim()).slice(0, 10);
    
    formData.customSelects.push({
      index: i,
      label: label || parentLabel || '未知字段',
      className,
      options,
      placeholder: input?.placeholder || '',
      html: el.outerHTML.slice(0, 800)
    });
  });

  document.querySelectorAll('[class*="date"], [class*="picker"], input[type="date"]').forEach((el, i) => {
    const label = getFieldLabel(el);
    formData.datePickers.push({
      index: i,
      label,
      className: el.className,
      type: el.type,
      html: el.outerHTML.slice(0, 500)
    });
  });

  document.querySelectorAll('[class*="time"], input[type="time"]').forEach((el, i) => {
    const label = getFieldLabel(el);
    formData.timePickers.push({
      index: i,
      label,
      className: el.className,
      type: el.type,
      html: el.outerHTML.slice(0, 500)
    });
  });

  document.querySelectorAll('[class*="cascade"], [class*="cascader"]').forEach((el, i) => {
    const label = getFieldLabel(el);
    formData.cascaders.push({
      index: i,
      label,
      className: el.className,
      html: el.outerHTML.slice(0, 800)
    });
  });

  if (IS_DEBUG) {
    console.log('[快填] 采集的表单 DOM 结构:', formData);
    sendToBackground({ type: 'COLLECT_FORM_DOM', data: formData }).catch(e => console.warn('[快填] 采集 DOM 失败:', e));
  }

  return formData;
}

async function doFill() {
  console.log('[快填] doFill 开始执行');
  if (_filling) { showToast('填写中，请稍候...', 'warn'); return; }
  _filling = true;
  console.log('[快填] _filling 设置为 true');
  
  let unfilledFields = [];
  showProgressPanel();
  updateProgress('正在初始化...', 5, '准备开始填写');
  
  try {
    console.log('[快填] 开始 collectFormDOM');
    collectFormDOM();
    console.log('[快填] collectFormDOM 完成');

    updateProgress('正在读取简历...', 10, '从存储中获取简历数据');
    console.log('[快填] 开始 getResume');
    const resume = await getResume();
    console.log('[快填] getResume 完成, resume:', resume ? '有数据' : '无数据');
    if (!resume) {
      updateProgress('错误：未找到简历', 0, '请先上传并解析简历');
      showNoResumeDialog();
      return;
    }

    updateProgress('正在扫描页面表单...', 20, '识别可填写字段');
    console.log('[快填] 开始 scanFields');
    const fields = await scanFields();
    console.log('[快填] scanFields 完成, fields.length:', fields.length);
    if (fields.length === 0) {
      updateProgress('未找到字段', 0, '当前页面无可填写字段');
      showToast('未找到可填写的表单字段', 'warn');
      return;
    }
    
    updateProgress(`发现 ${fields.length} 个字段`, 25, '开始AI分析');
    
    startFieldChangeObserver(fields);
    
    if (IS_DEBUG) {
      console.log(`[快填] 扫描到 ${fields.length} 个字段，开始调用 LLM 生成填写计划...`);
      console.log(`[快填] 扫描到的完整字段列表:`, fields);
      fields.forEach((field, index) => {
        if (field.hint.includes('论文') || field.hint.includes('专著') || field.hint.includes('名称') || field.hint.includes('证书')) {
          console.log(`[快填] 字段 #${field.id} hint: "${field.hint}", section: "${field.section}", ctx: "${field.ctx.slice(0, 100)}"`);
        }
      });
    }

    startScanAnimation(fields);

    updateProgress('AI 分析中...', 35, '正在生成填写计划');
    showToast(`扫描到 ${fields.length} 个字段，AI 分析中...`, 'info', 60000);
    
    const evolutionMemory = await getEvolutionMemoryForLLM();
    console.log('[快填] 进化系统记忆:', evolutionMemory);
    
    console.log('[快填] 发送 FILL_PLAN 消息，resume.full_name:', resume.full_name);
    const resp = await sendToBackground({ type: 'FILL_PLAN', fields, resume, evolutionMemory });
    console.log('[快填] FILL_PLAN 响应:', resp);
    if (!resp || !resp.ok) {
      updateProgress('AI 分析失败', 0, resp?.error || '未知错误');
      showToast('AI 分析失败：' + (resp?.error || '未知错误'), 'error');
      return;
    }
    const plan = resp.plan || {};
    const planCount = Object.keys(plan).length;
    if (IS_DEBUG) console.log(`[快填] LLM 计划: ${planCount} 个字段有填写方案`, plan);

    if (planCount === 0) {
      updateProgress('未找到匹配', 50, '尝试使用进化系统记忆');
      showToast('AI 未找到匹配的字段，请检查简历是否已解析', 'warn');
      return;
    }

    updateProgress('正在填写...', 50, `计划填写 ${planCount} 个字段`);
    showToast('正在填写...', 'info', 10000);
    console.log('[快填] 开始 applyPlan');
    const filled = await applyPlan(fields, plan, resume);
    console.log('[快填] applyPlan 完成, filled:', filled);

    updateProgress('处理下拉框...', 70, 'Phoenix选择器处理');
    showToast('正在填写 Phoenix 下拉框和日期选择器...', 'info', 10000);
    let phoenixFilled = 0;
    console.log('[快填] 检查 window.fillAllPhoenixSelects:', typeof window.fillAllPhoenixSelects);
    if (window.fillAllPhoenixSelects) {
      console.log('[快填] 当前 resume 数据:', JSON.stringify(resume, null, 2));
      console.log('[快填] 开始 fillAllPhoenixSelects');
      phoenixFilled = await window.fillAllPhoenixSelects(resume);
      console.log('[快填] fillAllPhoenixSelects 完成, phoenixFilled:', phoenixFilled);
    }

    stopScanAnimation();

    unfilledFields = fields.filter(f => !plan[f.id]);
    const totalFields = fields.length;
    const filledTotal = filled + phoenixFilled;
    
    updateProgress('完成', 100, `已填写 ${filledTotal}/${totalFields} 个字段`);
    
    if (filledTotal > 0) {
      let message = `✓ 已填写 ${filledTotal} 个字段`;
      if (unfilledFields.length > 0) {
        message += `\n⚠ 有 ${unfilledFields.length} 个字段未自动填写`;
        updateProgress('部分完成', 100, `有 ${unfilledFields.length} 个字段需要手动填写`);
      }
      showToast(message, filledTotal > 0 ? 'success' : 'warn', 5000);
      
      if (unfilledFields.length > 0) {
        setTimeout(() => {
          const unfilledList = unfilledFields.slice(0, 5).map(f => f.hint || f.id).join('、');
          const more = unfilledFields.length > 5 ? `等${unfilledFields.length}个` : '';
          showToast(`请检查并手动填写：${unfilledList}${more}`, 'warn', 6000);
        }, 1500);
      }
    } else {
      updateProgress('填写未生效', 100, '请手动核对');
      showToast('字段已识别但填写未生效，请手动核对', 'warn');
    }
    
    hideProgressPanel();
    console.log('[快填] doFill 正常结束');
  } catch(e) {
    console.error('[快填] 填写异常:', e);
    updateProgress('出错', 0, e.message);
    showToast('填写出错：' + e.message, 'error');
  } finally {
    stopScanAnimation();
    _filling = false;
    console.log('[快填] _filling 设置为 false');
  }
}

// ========== 悬浮按钮和进度面板 ==========

let fabEl = null;
let progressPanel = null;
let fabX = 18, fabY = 24;
let panelX = 18, panelY = 80;

function buildProgressPanel() {
  if (progressPanel) return progressPanel;
  
  progressPanel = document.createElement('div');
  progressPanel.id = 'rqf-progress-panel';
  progressPanel.innerHTML = `
    <div class="rqf-panel-header">
      <span class="rqf-panel-title">⚡ 简历快填</span>
      <button class="rqf-panel-close" title="关闭">×</button>
    </div>
    <div class="rqf-panel-body">
      <div class="rqf-progress-status">等待开始...</div>
      <div class="rqf-progress-bar">
        <div class="rqf-progress-fill" style="width: 0%"></div>
      </div>
      <div class="rqf-progress-detail"></div>
    </div>
  `;
  progressPanel.style.cssText = [
    'position:fixed',
    `right:${panelX}px`,
    `bottom:${panelY}px`,
    'z-index:2147483646',
    'width:280px',
    'background:linear-gradient(135deg,#1a1d27 0%,#161925 100%)',
    'border:1px solid #2e3248',
    'border-radius:12px',
    'box-shadow:0 8px 32px rgba(0,0,0,.5)',
    'font-family:-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif',
    'color:#e2e8f0',
    'overflow:hidden',
    'display:none'
  ].join(';');
  
  const style = document.createElement('style');
  style.textContent = `
    .rqf-panel-header {
      display:flex;align-items:center;justify-content:space-between;
      padding:10px 14px;background:rgba(108,99,255,.1);
      border-bottom:1px solid #2e3248;cursor:move;
    }
    .rqf-panel-title {font-size:13px;font-weight:600;color:#a78bfa;}
    .rqf-panel-close {
      width:24px;height:24px;border:none;background:transparent;
      color:#8892a4;font-size:18px;cursor:pointer;border-radius:4px;
      display:flex;align-items:center;justify-content:center;
    }
    .rqf-panel-close:hover {background:rgba(239,68,68,.2);color:#ef4444;}
    .rqf-panel-body {padding:12px 14px;}
    .rqf-progress-status {font-size:12px;margin-bottom:8px;color:#e2e8f0;}
    .rqf-progress-bar {
      height:6px;background:#222536;border-radius:3px;overflow:hidden;
    }
    .rqf-progress-fill {
      height:100%;background:linear-gradient(90deg,#6c63ff,#a78bfa);
      border-radius:3px;transition:width .3s ease;
    }
    .rqf-progress-detail {font-size:11px;color:#8892a4;margin-top:8px;}
  `;
  document.head.appendChild(style);
  
  let isDragging = false, dragStartX = 0, dragStartY = 0;
  const header = progressPanel.querySelector('.rqf-panel-header');
  
  header.addEventListener('mousedown', e => {
    if (e.target.classList.contains('rqf-panel-close')) return;
    isDragging = false;
    dragStartX = e.clientX; dragStartY = e.clientY;
    const onMove = e => {
      const dx = dragStartX - e.clientX, dy = dragStartY - e.clientY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        isDragging = true;
        panelX = Math.max(0, Math.min(window.innerWidth - 300, panelX + dx));
        panelY = Math.max(0, Math.min(window.innerHeight - 200, panelY + dy));
        progressPanel.style.right = panelX + 'px';
        progressPanel.style.bottom = panelY + 'px';
        dragStartX = e.clientX; dragStartY = e.clientY;
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  
  progressPanel.querySelector('.rqf-panel-close').addEventListener('click', () => {
    progressPanel.style.display = 'none';
  });
  
  document.documentElement.appendChild(progressPanel);
  return progressPanel;
}

function showProgressPanel() {
  const panel = buildProgressPanel();
  panel.style.display = 'block';
  return panel;
}

function updateProgress(status, percent, detail) {
  if (!progressPanel) return;
  const statusEl = progressPanel.querySelector('.rqf-progress-status');
  const fillEl = progressPanel.querySelector('.rqf-progress-fill');
  const detailEl = progressPanel.querySelector('.rqf-progress-detail');
  
  if (statusEl) statusEl.textContent = status;
  if (fillEl) fillEl.style.width = percent + '%';
  if (detailEl) detailEl.textContent = detail || '';
}

function hideProgressPanel() {
  if (progressPanel) {
    setTimeout(() => {
      if (progressPanel) progressPanel.style.display = 'none';
    }, 2000);
  }
}

function buildFloatingButton() {
  if (fabEl) return;
  
  const fabStyle = document.createElement('style');
  fabStyle.id = 'rqf-fab-styles';
  fabStyle.textContent = `
    @keyframes rqf-fab-hover {
      from { transform: rotate(0deg); filter: hue-rotate(0deg) drop-shadow(0 0 8px rgba(124, 58, 237, 0.6)); }
      to { transform: rotate(360deg); filter: hue-rotate(30deg) drop-shadow(0 0 12px rgba(124, 58, 237, 0.8)); }
    }
    
    @keyframes rqf-fab-working {
      0% { transform: rotate(0deg); filter: hue-rotate(0deg) drop-shadow(0 0 10px rgba(124, 58, 237, 0.8)); }
      25% { transform: rotate(180deg); filter: hue-rotate(90deg) drop-shadow(0 0 20px rgba(58, 237, 124, 0.9)); }
      50% { transform: rotate(540deg); filter: hue-rotate(180deg) drop-shadow(0 0 30px rgba(237, 124, 58, 1)); }
      75% { transform: rotate(1080deg); filter: hue-rotate(270deg) drop-shadow(0 0 25px rgba(58, 124, 237, 0.9)); }
      100% { transform: rotate(1440deg); filter: hue-rotate(360deg) drop-shadow(0 0 15px rgba(124, 58, 237, 0.8)); }
    }
    
    #rqf-fab {
      position: fixed;
      z-index: 2147483647;
      width: 72px;
      height: 72px;
      border-radius: 50%;
      cursor: pointer;
      user-select: none;
      background: transparent;
      border: none;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.3s ease, filter 0.3s ease;
    }
    
    #rqf-fab img {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      object-fit: cover;
      transition: transform 0.3s ease;
    }
    
    #rqf-fab:hover img {
      animation: rqf-fab-hover 3s linear infinite;
    }
    
    #rqf-fab.working img {
      animation: rqf-fab-working 2s ease-in-out infinite;
    }
    
    #rqf-fab:active {
      transform: scale(0.95);
    }
  `;
  document.head.appendChild(fabStyle);
  
  fabEl = document.createElement('div');
  fabEl.id = 'rqf-fab';
  fabEl.style.right = fabX + 'px';
  fabEl.style.bottom = fabY + 'px';
  
  const img = document.createElement('img');
  img.src = chrome.runtime.getURL('ui/悬浮窗_resized.png');
  img.alt = '快填';
  img.draggable = false;
  fabEl.appendChild(img);

  // ========== 彩蛋系统 ==========
  let _clickCount = 0;
  let _clickTimer = null;
  const _easterEggMessages = [
    '🎉 发现彩蛋！你是个好奇宝宝~',
    '✨ 继续点！还有更多惊喜！',
    '🚀 你已经掌握了点击的艺术！',
    '💫 再来一次，召唤神龙！',
    '🌟 恭喜解锁隐藏成就：点击大师！',
    '🎊 你是真正的探索者！',
    '🔥 连击大师！'
  ];
  const _motivationalQuotes = [
    '💪 每一次投递都是新的开始，加油！',
    '🌟 你的简历很棒，HR一定会看到的！',
    '🎯 机会总是留给有准备的人！',
    '🌈 今天的努力，明天的收获！',
    '⭐ 相信自己，你是最棒的！',
    '🦄 愿你找到心仪的工作！',
    '🍀 好运正在路上，请保持微笑！',
    '🎯 每一份简历都承载着梦想！'
  ];

  function triggerEasterEgg() {
    _clickCount++;
    if (_clickTimer) clearTimeout(_clickTimer);
    _clickTimer = setTimeout(() => { _clickCount = 0; }, 1500);
    
    if (_clickCount >= 5 && _clickCount < 12) {
      const msg = _easterEggMessages[Math.min(_clickCount - 5, _easterEggMessages.length - 1)];
      showToast(msg, 'success', 3000);
    }
    if (_clickCount >= 12) {
      showSecretPanel();
      _clickCount = 0;
    }
  }

  function showSecretPanel() {
    const existing = document.getElementById('rqf-secret-panel');
    if (existing) { existing.remove(); return; }
    
    const panel = document.createElement('div');
    panel.id = 'rqf-secret-panel';
    panel.innerHTML = `
      <div class="rqf-secret-header">🎉 秘密基地</div>
      <div class="rqf-secret-content">
        <div class="rqf-secret-item" data-action="firework">🎆 放烟花</div>
        <div class="rqf-secret-item" data-action="rainbow">🌈 彩虹模式</div>
        <div class="rqf-secret-item" data-action="matrix">💻 黑客帝国</div>
        <div class="rqf-secret-item" data-action="snow">❄️ 下雪</div>
        <div class="rqf-secret-item" data-action="confetti">🎊 撒花</div>
        <div class="rqf-secret-item" data-action="quote">💬 励志语录</div>
      </div>
      <div class="rqf-secret-footer">点击效果 · 再点悬浮窗关闭</div>
    `;
    panel.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      z-index:2147483647;background:linear-gradient(135deg,#1a1d27,#0d0f14);
      border:2px solid #7c3aed;border-radius:16px;padding:20px;
      box-shadow:0 0 50px rgba(124,58,237,0.5);
      font-family:-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif;
      min-width:280px;
    `;
    
    const style = document.createElement('style');
    style.textContent = `
      .rqf-secret-header{font-size:18px;font-weight:700;color:#a78bfa;text-align:center;margin-bottom:16px;}
      .rqf-secret-content{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
      .rqf-secret-item{
        padding:12px;background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.3);
        border-radius:8px;color:#e2e8f0;font-size:13px;text-align:center;cursor:pointer;
        transition:all 0.2s;
      }
      .rqf-secret-item:hover{background:rgba(124,58,237,0.3);transform:scale(1.05);}
      .rqf-secret-footer{font-size:11px;color:#64748b;text-align:center;margin-top:16px;}
    `;
    document.head.appendChild(style);
    
    panel.querySelectorAll('.rqf-secret-item').forEach(item => {
      item.addEventListener('click', () => {
        triggerSecretEffect(item.dataset.action);
      });
    });
    document.body.appendChild(panel);
  }

  function triggerSecretEffect(action) {
    const panel = document.getElementById('rqf-secret-panel');
    if (panel) panel.remove();
    
    switch(action) {
      case 'firework': createFireworks(); break;
      case 'rainbow': enableRainbowMode(); break;
      case 'matrix': enableMatrixMode(); break;
      case 'snow': enableSnowEffect(); break;
      case 'confetti': createConfetti(); break;
      case 'quote': showRandomQuote(); break;
    }
  }

  function createFireworks() {
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        createSingleFirework(Math.random() * window.innerWidth, Math.random() * window.innerHeight * 0.6);
      }, i * 300);
    }
    showToast('🎆 愿你的求职之路烟花绽放！', 'success', 3000);
  }

  function createSingleFirework(x, y) {
    const colors = ['#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff'];
    const container = document.createElement('div');
    container.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:2147483646;pointer-events:none;`;
    
    for (let i = 0; i < 30; i++) {
      const particle = document.createElement('div');
      const angle = (i / 30) * Math.PI * 2;
      const velocity = 50 + Math.random() * 100;
      const color = colors[Math.floor(Math.random() * colors.length)];
      particle.style.cssText = `
        position:absolute;width:6px;height:6px;border-radius:50%;
        background:${color};box-shadow:0 0 6px ${color};
        animation:rqf-particle 1s ease-out forwards;
        --tx:${Math.cos(angle) * velocity}px;--ty:${Math.sin(angle) * velocity}px;
      `;
      container.appendChild(particle);
    }
    
    if (!document.getElementById('rqf-particle-style')) {
      const style = document.createElement('style');
      style.id = 'rqf-particle-style';
      style.textContent = `@keyframes rqf-particle{0%{transform:translate(0,0) scale(1);opacity:1;}100%{transform:translate(var(--tx),var(--ty)) scale(0);opacity:0;}}`;
      document.head.appendChild(style);
    }
    document.body.appendChild(container);
    setTimeout(() => container.remove(), 1000);
  }

  let _rainbowInterval = null;
  function enableRainbowMode() {
    if (_rainbowInterval) {
      clearInterval(_rainbowInterval);
      _rainbowInterval = null;
      document.body.style.filter = '';
      showToast('🌈 彩虹模式已关闭', 'info', 2000);
      return;
    }
    let hue = 0;
    _rainbowInterval = setInterval(() => {
      hue = (hue + 2) % 360;
      document.body.style.filter = `hue-rotate(${hue}deg)`;
    }, 50);
    showToast('🌈 彩虹模式！再点关闭', 'success', 2000);
  }

  let _matrixInterval = null;
  function enableMatrixMode() {
    if (_matrixInterval) {
      clearInterval(_matrixInterval);
      _matrixInterval = null;
      document.querySelectorAll('.rqf-matrix-rain').forEach(el => el.remove());
      showToast('💻 黑客帝国已关闭', 'info', 2000);
      return;
    }
    const style = document.createElement('style');
    style.textContent = `.rqf-matrix-rain{position:fixed;top:0;font-size:14px;color:#00ff00;text-shadow:0 0 5px #00ff00;pointer-events:none;z-index:2147483645;animation:rqf-matrix-fall linear forwards;}@keyframes rqf-matrix-fall{to{transform:translateY(100vh);}}`;
    document.head.appendChild(style);
    
    _matrixInterval = setInterval(() => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*';
      const rain = document.createElement('div');
      rain.className = 'rqf-matrix-rain';
      rain.textContent = chars[Math.floor(Math.random() * chars.length)];
      rain.style.left = Math.random() * 100 + 'vw';
      rain.style.animationDuration = (2 + Math.random() * 3) + 's';
      document.body.appendChild(rain);
      setTimeout(() => rain.remove(), 5000);
    }, 100);
    showToast('💻 欢迎来到黑客帝国！再点关闭', 'success', 2000);
  }

  let _snowInterval = null;
  function enableSnowEffect() {
    if (_snowInterval) {
      clearInterval(_snowInterval);
      _snowInterval = null;
      document.querySelectorAll('.rqf-snow').forEach(el => el.remove());
      showToast('❄️ 下雪已关闭', 'info', 2000);
      return;
    }
    const style = document.createElement('style');
    style.textContent = `.rqf-snow{position:fixed;top:-20px;font-size:20px;pointer-events:none;z-index:2147483645;animation:rqf-snow-fall 5s linear forwards;}@keyframes rqf-snow-fall{to{transform:translateY(100vh) rotate(360deg);}}`;
    document.head.appendChild(style);
    
    _snowInterval = setInterval(() => {
      const snow = document.createElement('div');
      snow.className = 'rqf-snow';
      snow.textContent = '❄';
      snow.style.left = Math.random() * 100 + 'vw';
      snow.style.opacity = 0.5 + Math.random() * 0.5;
      document.body.appendChild(snow);
      setTimeout(() => snow.remove(), 5000);
    }, 200);
    showToast('❄️ 下雪啦！再点关闭', 'success', 2000);
  }

  function createConfetti() {
    const colors = ['#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff','#ff8800'];
    for (let i = 0; i < 80; i++) {
      setTimeout(() => {
        const confetti = document.createElement('div');
        confetti.style.cssText = `
          position:fixed;top:-10px;left:${Math.random() * 100}vw;
          width:10px;height:10px;background:${colors[Math.floor(Math.random() * colors.length)]};
          pointer-events:none;z-index:2147483645;
          animation:rqf-confetti 3s linear forwards;
        `;
        document.body.appendChild(confetti);
        setTimeout(() => confetti.remove(), 3000);
      }, i * 20);
    }
    if (!document.getElementById('rqf-confetti-style')) {
      const style = document.createElement('style');
      style.id = 'rqf-confetti-style';
      style.textContent = `@keyframes rqf-confetti{to{transform:translateY(100vh) rotate(720deg);opacity:0;}}`;
      document.head.appendChild(style);
    }
    showToast('🎊 恭喜！愿求职之路鲜花盛开！', 'success', 3000);
  }

  function showRandomQuote() {
    showToast(_motivationalQuotes[Math.floor(Math.random() * _motivationalQuotes.length)], 'success', 4000);
  }

  function showCompletionCelebration() {
    if (Math.random() < 0.3) createConfetti();
    else if (Math.random() < 0.5) createSingleFirework(window.innerWidth / 2, window.innerHeight / 3);
    setTimeout(() => showToast(_motivationalQuotes[Math.floor(Math.random() * _motivationalQuotes.length)], 'success', 4000), 500);
  }

  let isDragging = false, dragStartX = 0, dragStartY = 0;
  
  // ========== 等待小游戏系统 - 悬浮窗弹球 ==========
  let _gameActive = false;
  let _gamePaused = false;
  let _gamePanel = null;
  let _gameScore = 0;
  let _gameLevel = 1;
  let _ball = null;
  let _blocks = [];
  let _ballX = 0, _ballY = 0, _ballVX = 0, _ballVY = 0;
  let _gameAnimationId = null;
  let _fabGameMode = false;
  let _gameLives = 3;
  let _combo = 0;
  let _lastHitTime = 0;

  const LEVELS = [
    { name: '初级', rows: 2, cols: 5, speed: 1.5, colors: ['#ff6b6b', '#f9ca24'] },
    { name: '中级', rows: 3, cols: 6, speed: 2, colors: ['#4ecdc4', '#45b7d1', '#a78bfa'] },
    { name: '高级', rows: 4, cols: 7, speed: 2.5, colors: ['#ff6b6b', '#4ecdc4', '#f9ca24', '#6c63ff'] },
    { name: '专家', rows: 5, cols: 8, speed: 3, colors: ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#a78bfa'] },
    { name: '大师', rows: 6, cols: 9, speed: 3.5, colors: ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#a78bfa', '#6c63ff', '#ef4444'] },
  ];

  function showGameAskDialog() {
    const existing = document.getElementById('rqf-game-ask');
    if (existing) existing.remove();
    
    const dialog = document.createElement('div');
    dialog.id = 'rqf-game-ask';
    dialog.innerHTML = `
      <div class="rqf-ask-overlay"></div>
      <div class="rqf-ask-content">
        <div class="rqf-ask-icon">🎮</div>
        <div class="rqf-ask-title">等待无聊？来玩弹球吧！</div>
        <div class="rqf-ask-rules">
          <div class="rqf-rule-item">🖱️ <b>移动悬浮窗</b> 接住弹球</div>
          <div class="rqf-rule-item">💥 <b>打碎方块</b> 获得分数</div>
          <div class="rqf-rule-item">⬆️ <b>通关后</b> 难度递增</div>
          <div class="rqf-rule-item">🎯 <b>悬浮窗位置</b> 决定反弹角度</div>
        </div>
        <div class="rqf-ask-buttons">
          <button class="rqf-ask-btn rqf-ask-skip" data-action="skip">不用了</button>
          <button class="rqf-ask-btn rqf-ask-play" data-action="play">开始游戏！</button>
        </div>
      </div>
    `;
    dialog.style.cssText = `
      position:fixed;z-index:2147483647;
      top:0;left:0;right:0;bottom:0;
      display:flex;align-items:center;justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif;
    `;
    
    if (!document.getElementById('rqf-game-ask-style')) {
      const style = document.createElement('style');
      style.id = 'rqf-game-ask-style';
      style.textContent = `
        .rqf-ask-overlay{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);}
        .rqf-ask-content{position:relative;background:linear-gradient(135deg,#1a1d27,#0d0f14);border:2px solid rgba(124,58,237,0.5);border-radius:16px;padding:24px;text-align:center;min-width:320px;max-width:380px;box-shadow:0 0 50px rgba(124,58,237,0.5);animation:rqf-pop 0.3s ease-out;}
        @keyframes rqf-pop{from{transform:scale(0.9);opacity:0;}to{transform:scale(1);opacity:1;}}
        .rqf-ask-icon{font-size:56px;margin-bottom:12px;animation:rqf-bounce 1s ease-in-out infinite;}
        @keyframes rqf-bounce{0%,100%{transform:translateY(0);}50%{transform:translateY(-10px);}}
        .rqf-ask-title{font-size:18px;font-weight:700;color:#a78bfa;margin-bottom:16px;}
        .rqf-ask-rules{background:rgba(0,0,0,0.3);border-radius:10px;padding:14px;margin-bottom:20px;text-align:left;}
        .rqf-rule-item{font-size:13px;color:#e2e8f0;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);}
        .rqf-rule-item:last-child{border-bottom:none;}
        .rqf-rule-item b{color:#a78bfa;}
        .rqf-ask-buttons{display:flex;gap:12px;justify-content:center;}
        .rqf-ask-btn{padding:12px 24px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.2s;}
        .rqf-ask-skip{background:rgba(255,255,255,0.08);color:#94a3b8;}
        .rqf-ask-skip:hover{background:rgba(255,255,255,0.15);color:#fff;}
        .rqf-ask-play{background:linear-gradient(135deg,#6c63ff,#a78bfa);color:#fff;box-shadow:0 4px 15px rgba(124,58,237,0.4);}
        .rqf-ask-play:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(124,58,237,0.6);}
      `;
      document.head.appendChild(style);
    }
    
    dialog.querySelector('[data-action="skip"]').addEventListener('click', () => {
      dialog.remove();
    });
    
    dialog.querySelector('[data-action="play"]').addEventListener('click', () => {
      dialog.remove();
      startPinballGame();
    });
    
    document.body.appendChild(dialog);
  }

  function startPinballGame() {
    _gameActive = true;
    _gamePaused = false;
    _gameScore = 0;
    _gameLevel = Math.floor(Math.random() * LEVELS.length);
    _fabGameMode = true;
    _gameLives = 3;
    _combo = 0;
    _lastHitTime = 0;
    
    const level = LEVELS[_gameLevel];
    
    const panel = document.createElement('div');
    panel.id = 'rqf-pinball-game';
    panel.innerHTML = `
      <div class="rqf-pb-header">
        <span class="rqf-pb-level">🎯 ${level.name}</span>
        <span class="rqf-pb-score">得分: 0</span>
        <span class="rqf-pb-lives">❤️❤️❤️</span>
      </div>
      <div class="rqf-pb-area" id="rqf-pb-area">
        <div class="rqf-pb-countdown" id="rqf-pb-countdown">3</div>
      </div>
      <div class="rqf-pb-footer">💡 移动悬浮窗接球 · 位置决定反弹角度</div>
    `;
    panel.style.cssText = `
      position:fixed;top:20px;left:50%;transform:translateX(-50%);
      z-index:2147483646;background:rgba(10,10,20,0.95);
      border:2px solid rgba(124,58,237,0.5);border-radius:14px;
      padding:14px;font-family:-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif;
      min-width:420px;box-shadow:0 0 40px rgba(124,58,237,0.4);
    `;
    
    if (!document.getElementById('rqf-pinball-style')) {
      const style = document.createElement('style');
      style.id = 'rqf-pinball-style';
      style.textContent = `
        .rqf-pb-header{display:flex;justify-content:space-between;margin-bottom:12px;font-size:13px;align-items:center;}
        .rqf-pb-level{color:#a78bfa;font-weight:600;}
        .rqf-pb-score{color:#22c55e;font-weight:700;font-size:14px;}
        .rqf-pb-lives{letter-spacing:2px;}
        .rqf-pb-area{width:400px;height:300px;background:linear-gradient(180deg,rgba(0,0,0,0.6) 0%,rgba(20,20,40,0.8) 100%);border-radius:10px;position:relative;overflow:hidden;border:1px solid rgba(124,58,237,0.3);}
        .rqf-pb-block{position:absolute;border-radius:4px;transition:all 0.15s;cursor:default;}
        .rqf-pb-block:hover{filter:brightness(1.2);}
        .rqf-pb-ball{position:absolute;width:18px;height:18px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#fff 0%,#a78bfa 50%,#6c63ff 100%);box-shadow:0 0 15px #a78bfa,0 0 30px rgba(167,139,250,0.5);z-index:10;}
        .rqf-pb-countdown{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:80px;font-weight:900;color:#a78bfa;text-shadow:0 0 30px rgba(167,139,250,0.8);animation:rqf-countdown-pulse 1s ease-in-out infinite;z-index:20;}
        @keyframes rqf-countdown-pulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:1;}50%{transform:translate(-50%,-50%) scale(1.1);opacity:0.8;}}
        .rqf-pb-footer{font-size:11px;color:#64748b;text-align:center;margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.05);}
        .rqf-pb-combo{position:absolute;top:10px;right:10px;font-size:12px;color:#f9ca24;font-weight:700;opacity:0;transition:opacity 0.3s;}
        .rqf-pb-particle{position:absolute;border-radius:50%;pointer-events:none;animation:rqf-particle-explode 0.5s ease-out forwards;}
        @keyframes rqf-particle-explode{to{transform:scale(0);opacity:0;}}
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(panel);
    _gamePanel = panel;
    
    let countdown = 3;
    const countdownEl = document.getElementById('rqf-pb-countdown');
    
    const countdownInterval = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        countdownEl.textContent = countdown;
      } else if (countdown === 0) {
        countdownEl.textContent = '开始!';
        countdownEl.style.fontSize = '40px';
      } else {
        clearInterval(countdownInterval);
        countdownEl.remove();
        createBlocks(level);
        createBall(level);
        gameLoop();
      }
    }, 1000);
  }

  function createBlocks(level) {
    const area = document.getElementById('rqf-pb-area');
    if (!area) return;
    
    _blocks = [];
    const blockWidth = (400 - 20) / level.cols;
    const blockHeight = 20;
    
    for (let row = 0; row < level.rows; row++) {
      for (let col = 0; col < level.cols; col++) {
        const block = document.createElement('div');
        block.className = 'rqf-pb-block';
        const color = level.colors[row % level.colors.length];
        block.style.cssText = `
          left:${10 + col * blockWidth}px;
          top:${10 + row * (blockHeight + 5)}px;
          width:${blockWidth - 4}px;height:${blockHeight}px;
          background:${color};box-shadow:0 0 8px ${color};
        `;
        area.appendChild(block);
        _blocks.push({ el: block, x: 10 + col * blockWidth, y: 10 + row * (blockHeight + 5), w: blockWidth - 4, h: blockHeight, active: true });
      }
    }
  }

  function createBall(level) {
    const area = document.getElementById('rqf-pb-area');
    if (!area) return;
    
    _ball = document.createElement('div');
    _ball.className = 'rqf-pb-ball';
    _ballX = 200;
    _ballY = 250;
    _ballVX = (Math.random() > 0.5 ? 1 : -1) * level.speed;
    _ballVY = -level.speed;
    _ball.style.left = _ballX + 'px';
    _ball.style.top = _ballY + 'px';
    area.appendChild(_ball);
  }

  function gameLoop() {
    if (!_gameActive || _gamePaused) return;
    
    const area = document.getElementById('rqf-pb-area');
    if (!area) return;
    
    _ballX += _ballVX;
    _ballY += _ballVY;
    
    if (_ballX <= 0 || _ballX >= 382) _ballVX = -_ballVX;
    if (_ballY <= 0) _ballVY = -_ballVY;
    
    if (_ballY >= 282) {
      const fabRect = fabEl.getBoundingClientRect();
      const areaRect = area.getBoundingClientRect();
      const fabCenterX = fabRect.left + fabRect.width / 2;
      const fabInAreaX = fabCenterX - areaRect.left;
      
      if (fabInAreaX > _ballX - 50 && fabInAreaX < _ballX + 68) {
        _ballVY = -Math.abs(_ballVY);
        const hitPos = (_ballX - fabInAreaX + 25) / 50;
        _ballVX = hitPos * 5;
        _gameScore += 5;
        _combo = 0;
        updateGameScore();
        createParticles(_ballX, _ballY, '#a78bfa', 5);
      } else if (_ballY >= 300) {
        _gameLives--;
        updateLives();
        if (_gameLives <= 0) {
          gameOver();
          return;
        }
        showToast(`💔 还有 ${_gameLives} 条命！`, 'warn', 1500);
        resetBall();
      }
    }
    
    const now = Date.now();
    _blocks.forEach(block => {
      if (!block.active) return;
      if (_ballX > block.x && _ballX < block.x + block.w &&
          _ballY > block.y && _ballY < block.y + block.h) {
        block.active = false;
        block.el.style.opacity = '0';
        block.el.style.transform = 'scale(0)';
        _ballVY = -_ballVY;
        
        if (now - _lastHitTime < 1000) {
          _combo++;
        } else {
          _combo = 1;
        }
        _lastHitTime = now;
        
        const comboBonus = _combo > 1 ? _combo * 5 : 0;
        _gameScore += 10 + comboBonus;
        updateGameScore();
        
        if (_combo > 1) {
          showCombo(_combo);
        }
        
        createParticles(block.x + block.w/2, block.y + block.h/2, block.el.style.background, 8);
      }
    });
    
    if (_blocks.every(b => !b.active)) {
      nextLevel();
    }
    
    _ball.style.left = _ballX + 'px';
    _ball.style.top = _ballY + 'px';
    
    _gameAnimationId = requestAnimationFrame(gameLoop);
  }

  function createParticles(x, y, color, count) {
    const area = document.getElementById('rqf-pb-area');
    if (!area) return;
    
    for (let i = 0; i < count; i++) {
      const particle = document.createElement('div');
      particle.className = 'rqf-pb-particle';
      const size = 4 + Math.random() * 6;
      const angle = (Math.PI * 2 / count) * i;
      const distance = 20 + Math.random() * 30;
      particle.style.cssText = `
        left:${x}px;top:${y}px;
        width:${size}px;height:${size}px;
        background:${color};
        box-shadow:0 0 6px ${color};
        transform:translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px);
      `;
      area.appendChild(particle);
      setTimeout(() => particle.remove(), 500);
    }
  }

  function showCombo(combo) {
    const area = document.getElementById('rqf-pb-area');
    if (!area) return;
    
    let comboEl = area.querySelector('.rqf-pb-combo');
    if (!comboEl) {
      comboEl = document.createElement('div');
      comboEl.className = 'rqf-pb-combo';
      area.appendChild(comboEl);
    }
    comboEl.textContent = `🔥 ${combo}连击!`;
    comboEl.style.opacity = '1';
    setTimeout(() => { comboEl.style.opacity = '0'; }, 800);
  }

  function updateLives() {
    const livesEl = _gamePanel?.querySelector('.rqf-pb-lives');
    if (livesEl) {
      livesEl.textContent = '❤️'.repeat(_gameLives) + '🖤'.repeat(3 - _gameLives);
    }
  }

  function gameOver() {
    _gameActive = false;
    _fabGameMode = false;
    if (_gameAnimationId) {
      cancelAnimationFrame(_gameAnimationId);
      _gameAnimationId = null;
    }
    
    const area = document.getElementById('rqf-pb-area');
    if (area) {
      area.innerHTML = `
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">
          <div style="font-size:48px;margin-bottom:16px;">😢</div>
          <div style="font-size:24px;font-weight:700;color:#ef4444;margin-bottom:8px;">游戏结束</div>
          <div style="font-size:16px;color:#a78bfa;">最终得分: ${_gameScore}</div>
        </div>
      `;
    }
    
    setTimeout(() => {
      if (_gamePanel) {
        _gamePanel.remove();
        _gamePanel = null;
      }
    }, 3000);
  }

  function resetBall() {
    const level = LEVELS[_gameLevel];
    _ballX = 200;
    _ballY = 250;
    _ballVX = (Math.random() > 0.5 ? 1 : -1) * level.speed;
    _ballVY = -level.speed;
  }

  function nextLevel() {
    _gameLevel = (_gameLevel + 1) % LEVELS.length;
    const level = LEVELS[_gameLevel];
    
    showToast(`🎉 进入 ${level.name} 关卡！`, 'success', 2000);
    
    const levelEl = _gamePanel?.querySelector('.rqf-pb-level');
    if (levelEl) levelEl.textContent = `关卡: ${level.name}`;
    
    const area = document.getElementById('rqf-pb-area');
    if (area) {
      area.innerHTML = '';
      createBlocks(level);
      createBall(level);
    }
  }

  function updateGameScore() {
    const scoreEl = _gamePanel?.querySelector('.rqf-pb-score');
    if (scoreEl) scoreEl.textContent = `得分: ${_gameScore}`;
  }

  function pauseGame() {
    _gamePaused = true;
    if (_gameAnimationId) {
      cancelAnimationFrame(_gameAnimationId);
      _gameAnimationId = null;
    }
  }

  function resumeGame() {
    _gamePaused = false;
    gameLoop();
  }

  function showContinueDialog() {
    if (!_gameActive) return;
    
    pauseGame();
    
    const dialog = document.createElement('div');
    dialog.id = 'rqf-continue-dialog';
    dialog.innerHTML = `
      <div class="rqf-ask-content">
        <div class="rqf-ask-icon">⏸️</div>
        <div class="rqf-ask-title">填写完成！</div>
        <div class="rqf-ask-text">当前得分: ${_gameScore} 分\n要继续游戏吗？</div>
        <div class="rqf-ask-buttons">
          <button class="rqf-ask-btn rqf-ask-skip" data-action="end">结束游戏</button>
          <button class="rqf-ask-btn rqf-ask-play" data-action="continue">继续游戏</button>
        </div>
      </div>
    `;
    dialog.style.cssText = `
      position:fixed;z-index:2147483647;
      top:0;left:0;right:0;bottom:0;
      display:flex;align-items:center;justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif;
    `;
    
    const overlay = document.createElement('div');
    overlay.className = 'rqf-ask-overlay';
    dialog.insertBefore(overlay, dialog.firstChild);
    
    dialog.querySelector('[data-action="end"]').addEventListener('click', () => {
      dialog.remove();
      endGame();
    });
    
    dialog.querySelector('[data-action="continue"]').addEventListener('click', () => {
      dialog.remove();
      resumeGame();
    });
    
    document.body.appendChild(dialog);
  }

  function endGame() {
    _gameActive = false;
    _fabGameMode = false;
    if (_gameAnimationId) {
      cancelAnimationFrame(_gameAnimationId);
      _gameAnimationId = null;
    }
    if (_gamePanel) {
      _gamePanel.remove();
      _gamePanel = null;
    }
    showToast(`🎮 游戏结束！最终得分: ${_gameScore}`, 'success', 3000);
  }

  function hideWaitingGame() {
    if (_gameActive) {
      showContinueDialog();
    } else {
      endGame();
    }
  }
  
  fabEl.addEventListener('mousedown', e => {
    isDragging = false;
    dragStartX = e.clientX; dragStartY = e.clientY;
    const onMove = e => {
      const dx = dragStartX - e.clientX, dy = dragStartY - e.clientY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        isDragging = true;
        fabX = Math.max(0, Math.min(window.innerWidth - 72, fabX + dx));
        fabY = Math.max(0, Math.min(window.innerHeight - 72, fabY + dy));
        fabEl.style.right = fabX + 'px';
        fabEl.style.bottom = fabY + 'px';
        dragStartX = e.clientX; dragStartY = e.clientY;
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  let _fillPending = false;
  
  fabEl.addEventListener('click', async e => {
    if (isDragging) return;
    
    const secretPanel = document.getElementById('rqf-secret-panel');
    if (secretPanel) { secretPanel.remove(); return; }
    
    _clickCount++;
    if (_clickTimer) clearTimeout(_clickTimer);
    
    if (_clickCount >= 5 && _clickCount < 12) {
      const msg = _easterEggMessages[Math.min(_clickCount - 5, _easterEggMessages.length - 1)];
      showToast(msg, 'success', 1500);
    }
    if (_clickCount >= 12) {
      showSecretPanel();
      _clickCount = 0;
      return;
    }
    
    _clickTimer = setTimeout(async () => {
      if (_clickCount < 5) {
        showGameAskDialog();
        fabEl.classList.add('working');
        try { await doFill(); }
        finally {
          fabEl.classList.remove('working');
          hideWaitingGame();
          showCompletionCelebration();
        }
      }
      _clickCount = 0;
    }, 400);
  });

  document.documentElement.appendChild(fabEl);
}

function removeFloatingButton() {
  if (fabEl) { fabEl.remove(); fabEl = null; }
}

// ========== 翻页检测 ==========

let _lastUrl = location.href;
let _pageChangeDialogShown = false;

function showPageChangeDialog() {
  if (_pageChangeDialogShown) return;
  _pageChangeDialogShown = true;
  
  const dialog = document.createElement('div');
  dialog.id = 'rqf-page-change-dialog';
  dialog.innerHTML = `
    <div class="rqf-dialog-overlay"></div>
    <div class="rqf-dialog-content">
      <div class="rqf-dialog-title">⚡ 检测到页面变化</div>
      <div class="rqf-dialog-text">页面已更新，是否继续自动填写？</div>
      <div class="rqf-dialog-buttons">
        <button class="rqf-dialog-btn rqf-dialog-btn-secondary" data-action="cancel">取消</button>
        <button class="rqf-dialog-btn rqf-dialog-btn-primary" data-action="continue">继续填写</button>
      </div>
    </div>
  `;
  
  dialog.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
    'z-index:2147483647', 'display:flex', 'align-items:center',
    'justify-content:center', 'font-family:-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif'
  ].join(';');
  
  const style = document.createElement('style');
  style.textContent = `
    .rqf-dialog-overlay {position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);}
    .rqf-dialog-content {
      position:relative;background:linear-gradient(135deg,#1a1d27 0%,#161925 100%);
      border:1px solid #2e3248;border-radius:12px;padding:20px 24px;
      min-width:300px;max-width:400px;box-shadow:0 20px 60px rgba(0,0,0,.5);
    }
    .rqf-dialog-title {font-size:15px;font-weight:600;color:#a78bfa;margin-bottom:12px;}
    .rqf-dialog-text {font-size:13px;color:#e2e8f0;margin-bottom:20px;line-height:1.5;}
    .rqf-dialog-buttons {display:flex;gap:10px;justify-content:flex-end;}
    .rqf-dialog-btn {
      padding:8px 16px;border-radius:8px;font-size:13px;font-weight:500;
      cursor:pointer;border:none;transition:all .2s;
    }
    .rqf-dialog-btn-secondary {background:#222536;color:#e2e8f0;border:1px solid #2e3248;}
    .rqf-dialog-btn-secondary:hover {background:#2e3248;}
    .rqf-dialog-btn-primary {background:linear-gradient(135deg,#6c63ff,#a78bfa);color:#fff;}
    .rqf-dialog-btn-primary:hover {opacity:.9;}
  `;
  document.head.appendChild(style);
  
  dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => {
    dialog.remove();
    _pageChangeDialogShown = false;
  });
  
  dialog.querySelector('[data-action="continue"]').addEventListener('click', () => {
    dialog.remove();
    _pageChangeDialogShown = false;
    doFill().catch(console.error);
  });
  
  document.documentElement.appendChild(dialog);
  
  setTimeout(() => {
    if (dialog.parentNode) {
      dialog.remove();
      _pageChangeDialogShown = false;
    }
  }, 15000);
}

function setupPageChangeListener() {
  if (!isRecruitSite(window.location.href)) {
    console.log('[快填] 非招聘网站，不启用翻页检测');
    return;
  }
  
  const observer = new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      console.log('[快填] 检测到页面变化:', _lastUrl);
      
      if (!_filling && !_pageChangeDialogShown) {
        setTimeout(() => {
          showPageChangeDialog();
        }, 500);
      }
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
  
  window.addEventListener('popstate', () => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      console.log('[快填] 检测到 popstate 变化:', _lastUrl);
      if (!_filling && !_pageChangeDialogShown) {
        setTimeout(() => showPageChangeDialog(), 500);
      }
    }
  });
}

// ========== 初始化 ==========

function init() {
  if (IS_DEBUG) console.log('[快填] content-script 初始化');

  chrome.runtime.sendMessage({ type: 'GET_STATE' }, r => {
    if (chrome.runtime.lastError) return;
    const state = r?.ok ? r.state : {};
    if (shouldShowButton(location.href, state)) buildFloatingButton();
  });
  
  setupPageChangeListener();

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'TRIGGER_FILL') {
      doFill().catch(console.error);
      sendResponse({ ok: true });
    }
    if (msg.type === 'STATE_UPDATED') {
      const state = msg.state || {};
      if (shouldShowButton(location.href, state)) {
        buildFloatingButton();
      } else {
        removeFloatingButton();
      }
    }
    if (msg.type === 'BLACKLIST_UPDATED') {
      removeFloatingButton();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
