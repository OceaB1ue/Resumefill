// api.js - 封装后端 API 调用
// 调试模式：指向本地后端；生产模式：指向服务器IP
const IS_DEBUG = false; // 发布模式，指向服务器IP

const API_BASE = IS_DEBUG
  ? "http://127.0.0.1:8200"
  : "http://62.234.168.105:8200"; // 服务器IP地址

async function safeFetch(path, options = {}) {
  const url = API_BASE.replace(/\/+$/, "") + path;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      return await res.json();
    }
    return await res.text();
  } catch (e) {
    if (e.name === "AbortError") throw new Error("请求超时，请检查网络或服务器状态。");
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export const apiClient = {
  async parseResume(file) {
    const formData = new FormData();
    formData.append("file", file);
    return safeFetch("/parse-resume", {
      method: "POST",
      body: formData
    });
  },

  async sendFeedback(payload) {
    return safeFetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  },

  async getRules() {
    return safeFetch("/api/rules", { method: "GET" });
  },

  async getSiteRules() {
    return safeFetch("/api/site-rules", { method: "GET" });
  },

  async activateCode(code, deviceId) {
    return safeFetch("/api/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, device_id: deviceId })
    });
  },

  async healthCheck() {
    return safeFetch("/health", { method: "GET" });
  }
};
