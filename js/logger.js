// =====================================================
// MYTHOS PROD - Activity Logger
// =====================================================

const LOGGER = {
  MAX_LOGS: 200,
  STORAGE_KEY: 'mp_activity_log',

  log(action, details = {}) {
    try {
      const logs = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
      logs.unshift({
        id: Date.now(),
        timestamp: new Date().toISOString(),
        action,
        details
      });
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(logs.slice(0, this.MAX_LOGS)));
    } catch (e) {
      console.warn('[LOGGER] Failed to write log:', e);
    }
  },

  getLogs() {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
    } catch (e) {
      return [];
    }
  },

  clearLogs() {
    localStorage.removeItem(this.STORAGE_KEY);
  },

  exportLogs() {
    const logs = this.getLogs();
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mythos-logs-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }
};
