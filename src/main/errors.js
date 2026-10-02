'use strict';

/**
 * 把引擎/网络错误收成给用户看的中文短句。
 * 不读取请求头，避免把 API Key 带进文案。
 */

const FREE_NAMES = { google: 'Google', microsoft: '微软翻译', tencent: '腾讯翻译' };

function networkHint(service, timedOut) {
  if (service === 'google') {
    return timedOut
      ? '连接 Google 超时，换微软或大模型试试'
      : '网络连不上 Google，换微软或大模型试试';
  }
  if (service === 'tencent') {
    return timedOut
      ? '连接腾讯翻译超时，换微软或大模型试试'
      : '网络连不上腾讯翻译，换微软或大模型试试';
  }
  if (service === 'microsoft') {
    return timedOut
      ? '连接微软翻译超时，换 Google 或大模型试试'
      : '网络连不上微软翻译，换 Google 或大模型试试';
  }
  const name = service || '大模型接口';
  return timedOut
    ? `连接 ${name} 超时，检查网络后再试`
    : `网络连不上 ${name}，检查网络后再试`;
}

/**
 * @param {any} err
 * @param {{service?: string, kind?: 'free'|'llm'}} [ctx]
 * @returns {string}
 */
function userMessage(err, ctx = {}) {
  if (!err) return '翻译失败';
  if (err.code === 'CANCEL') return '已取消';
  if (err.code === 'NO_KEY') return '还没填大模型的 API Key，去设置里填一下';
  if (err.code === 'NO_BASE_URL') return '还没填写大模型的接口地址';
  if (err.code === 'NO_MODEL') return '还没填写模型名';

  const status = Number(err.status || err.statusCode || 0);
  const kind = ctx.kind || err.kind;
  if (status === 401 || status === 403) {
    if (kind === 'free') {
      const who = FREE_NAMES[ctx.service || err.service] || '微软翻译';
      return `${who}拒绝了这次请求，换一个引擎或改用大模型试试`;
    }
    return 'API Key 无效或没有权限';
  }
  if (status === 404) {
    if (kind === 'free') {
      const who = FREE_NAMES[ctx.service || err.service] || '微软翻译';
      return `${who}的免费接口不可用，换一个引擎或改用大模型试试`;
    }
    return '模型名或接口地址不对';
  }
  if (status === 429) return '请求太频繁或额度用完了';
  if (status >= 500 && status <= 599) return '翻译服务暂时不可用，过一会儿再试';
  if (status) return `翻译请求失败（HTTP ${status}）`;

  const service = ctx.service || err.service;
  if (err.code === 'TIMEOUT') return networkHint(service, true);
  if (err.code === 'NETWORK') return networkHint(service, false);
  if (err.code === 'BAD_RESPONSE') {
    if (service === 'google') return 'Google 翻译返回了无法识别的结果，换微软或大模型试试';
    if (service === 'microsoft') return '微软翻译返回了无法识别的结果，换 Google 或大模型试试';
    if (service === 'tencent') return '腾讯翻译返回了无法识别的结果，换微软或大模型试试';
    return '翻译结果无法识别';
  }

  const message = typeof err.message === 'string' ? err.message : '';
  if (/[\u4e00-\u9fff]/.test(message)) return message;
  return '翻译失败';
}

function fail(code, extra = {}) {
  const err = new Error(code);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

module.exports = { userMessage, fail, networkHint };
