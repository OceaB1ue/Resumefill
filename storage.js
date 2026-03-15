// storage.js - 封装 chrome.storage.local 的读写

const DEFAULT_STATE = {
  resumeData: null,
  resumeRaw: "",
  rules: null,
  rulesVersion: 0,
  siteRules: null,
  siteRulesVersion: 0,
  activationStatus: {
    activated: false,
    code: "",
    deviceId: "",
    activatedAt: 0
  },
  usageCount: 0,
  userMemory: {},
  blacklistDomains: [],
  floatMode: "smart",
  globalFieldMemory: {},
  installTime: 0,
  deviceFingerprint: ""
};

const FIELD_MEMORY_KEY = 'globalFieldMemory_v2';
const FINGERPRINT_KEY = 'device_fingerprint_v1';
const INSTALL_TIME_KEY = 'install_time_v1';

function getStorage() {
  return chrome.storage.local;
}

async function generateDeviceFingerprint() {
  const components = [];
  
  components.push(navigator.userAgent);
  components.push(navigator.language);
  components.push(screen.width + 'x' + screen.height);
  components.push(screen.colorDepth);
  components.push(new Date().getTimezoneOffset());
  components.push(navigator.hardwareConcurrency || 'unknown');
  components.push(navigator.platform);
  
  const canvas = document.createElement('canvas');
  try {
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('fingerprint', 2, 2);
    components.push(canvas.toDataURL().slice(0, 100));
  } catch(e) {}
  
  const data = components.join('|');
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36) + Date.now().toString(36).slice(-4);
}

function normalizeFieldLabel(label) {
  if (!label) return '';
  return label.toLowerCase()
    .replace(/[\s\u3000\-_:：]+/g, '')
    .replace(/姓名|真实姓名|您的姓名/g, '姓名')
    .replace(/手机|电话|联系电话|手机号码/g, '手机')
    .replace(/邮箱|电子邮件|email/g, '邮箱')
    .replace(/学校|毕业院校|就读院校/g, '学校')
    .replace(/专业|专业名称|所学专业/g, '专业')
    .replace(/学历|学位|最高学历/g, '学历')
    .replace(/公司|单位|实习单位|企业/g, '公司')
    .replace(/职位|岗位|职务/g, '职位');
}

function getFieldSemanticKey(label, section) {
  const normalized = normalizeFieldLabel(label);
  const sectionKeywords = {
    'education': ['学校', '专业', '学历', '入学', '毕业', '学位'],
    'work': ['公司', '职位', '工作', '实习', '入职', '离职'],
    'project': ['项目', '角色', '项目名'],
    'basic': ['姓名', '手机', '邮箱', '性别', '出生', '现居', '地址']
  };
  
  for (const [sec, keywords] of Object.entries(sectionKeywords)) {
    if (keywords.some(k => normalized.includes(k))) {
      return `${sec}:${normalized}`;
    }
  }
  
  return `unknown:${normalized}`;
}

export const storage = {
  async initDefaults() {
    const current = await this.getState();
    const patched = {};
    
    for (const [k, v] of Object.entries(DEFAULT_STATE)) {
      if (current[k] === undefined || current[k] === null) {
        if (k !== "resumeData" && k !== "siteRules" && k !== "rules") {
          patched[k] = v;
        }
      }
    }
    
    if (!current.installTime || current.installTime === 0) {
      patched.installTime = Date.now();
    }
    
    if (!current.deviceFingerprint) {
      patched.deviceFingerprint = await generateDeviceFingerprint();
    }
    
    if (Object.keys(patched).length > 0) {
      await getStorage().set(patched);
    }
  },

  async getState() {
    return new Promise(resolve => {
      getStorage().get(null, data => {
        resolve({ ...DEFAULT_STATE, ...(data || {}) });
      });
    });
  },

  async mergeState(patch) {
    await getStorage().set(patch);
  },

  async incrementUsage() {
    const current = await this.getState();
    const next = (current.usageCount || 0) + 1;
    await getStorage().set({ usageCount: next });
    return next;
  },

  async clearAll() {
    const current = await this.getState();
    const preservedFingerprint = current.deviceFingerprint;
    const preservedInstallTime = current.installTime;
    const preservedActivation = current.activationStatus;
    
    await getStorage().clear();
    await getStorage().set({ 
      ...DEFAULT_STATE,
      deviceFingerprint: preservedFingerprint,
      installTime: preservedInstallTime,
      activationStatus: preservedActivation && preservedActivation.activated ? preservedActivation : DEFAULT_STATE.activationStatus
    });
  },

  async getDeviceId() {
    const current = await this.getState();
    if (current.activationStatus?.deviceId) {
      return current.activationStatus.deviceId;
    }
    if (current.deviceFingerprint) {
      return current.deviceFingerprint;
    }
    return await generateDeviceFingerprint();
  },

  async getInstallTime() {
    const current = await this.getState();
    return current.installTime || 0;
  },

  async isFreshInstall() {
    const current = await this.getState();
    if (!current.installTime) return true;
    const hoursSinceInstall = (Date.now() - current.installTime) / (1000 * 60 * 60);
    return hoursSinceInstall < 1;
  },

  async addToBlacklist(domain) {
    const current = await this.getState();
    const list = new Set(current.blacklistDomains || []);
    list.add(domain);
    await getStorage().set({ blacklistDomains: Array.from(list) });
  },
  
  // ===== 全局字段记忆库（跨网站语义迁移）=====
  async getGlobalFieldMemory() {
    return new Promise(resolve => {
      getStorage().get(FIELD_MEMORY_KEY, data => {
        resolve(data[FIELD_MEMORY_KEY] || {});
      });
    });
  },

  async saveGlobalFieldMemory(label, section, value, siteKey) {
    const semanticKey = getFieldSemanticKey(label, section);
    if (!semanticKey || !value) return;
    
    const memory = await this.getGlobalFieldMemory();
    if (!memory[semanticKey]) {
      memory[semanticKey] = {
        value: value,
        label: label,
        section: section,
        sites: [],
        count: 0,
        firstSeen: Date.now(),
        lastUpdated: Date.now()
      };
    }
    
    memory[semanticKey].value = value;
    memory[semanticKey].lastUpdated = Date.now();
    memory[semanticKey].count = (memory[semanticKey].count || 0) + 1;
    
    if (!memory[semanticKey].sites.includes(siteKey)) {
      memory[semanticKey].sites.push(siteKey);
    }
    
    await getStorage().set({ [FIELD_MEMORY_KEY]: memory });
    console.log(`[进化系统] 已记忆字段: ${semanticKey} = ${value}`);
  },

  async getGlobalFieldMatch(label, section) {
    const semanticKey = getFieldSemanticKey(label, section);
    const memory = await this.getGlobalFieldMemory();
    
    if (memory[semanticKey]) {
      console.log(`[进化系统] 找到匹配记忆: ${semanticKey} = ${memory[semanticKey].value}`);
      return memory[semanticKey].value;
    }
    
    const normalized = normalizeFieldLabel(label);
    for (const [key, data] of Object.entries(memory)) {
      const keyNormalized = key.split(':')[1] || '';
      if (normalized.includes(keyNormalized) || keyNormalized.includes(normalized)) {
        console.log(`[进化系统] 模糊匹配: ${label} -> ${key} = ${data.value}`);
        return data.value;
      }
    }
    
    return null;
  },

  async getAllGlobalFieldMemory() {
    return await this.getGlobalFieldMemory();
  },

  // ===== 站点级别字段记忆库 =====
  // key: siteKey (e.g. "360campus.zhiye.com")
  // value: { fieldKey: { hint, value, updatedAt } }
  async getFieldMemory(siteKey) {
    return new Promise(resolve => {
      const storageKey = 'fieldMemory_' + siteKey;
      getStorage().get(storageKey, data => {
        resolve(data[storageKey] || {});
      });
    });
  },

  async setFieldMemory(siteKey, fieldKey, hint, value) {
    const mem = await this.getFieldMemory(siteKey);
    mem[fieldKey] = { hint, value, updatedAt: Date.now() };
    const storageKey = 'fieldMemory_' + siteKey;
    await getStorage().set({ [storageKey]: mem });
  },

  async getFieldMemoryAll(siteKey) {
    return this.getFieldMemory(siteKey);
  }

};
