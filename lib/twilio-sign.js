// Twilio webhook signature (HMAC-SHA1 over the public URL + sorted form fields).
// Fail closed when TWILIO_AUTH_TOKEN is missing. Does not throw.
'use strict';

const crypto = require('crypto');
const {safeEqual} = require('./sync');

function authToken() {
  return String(process.env.TWILIO_AUTH_TOKEN || '').trim();
}

function requestUrl(req) {
  let proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (!proto) proto = 'http';
  let host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  if ((proto === 'https' && host.endsWith(':443')) || (proto === 'http' && host.endsWith(':80'))) {
    host = host.slice(0, host.lastIndexOf(':'));
  }
  return proto + '://' + host + (req.url || '/');
}

function signatureFor(token, url, params) {
  const data = Object.keys(params || {}).sort().reduce((acc, key) => acc + key + params[key], url);
  return crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
}

function paramsFromBody(raw) {
  const params = {};
  const form = new URLSearchParams(String(raw || ''));
  for (const [key, value] of form.entries()) params[key] = value;
  return params;
}

function verify(req, rawBody) {
  const token = authToken();
  if (!token) return {ok: false, reason: 'missing-token'};
  const sent = String(req.headers['x-twilio-signature'] || req.headers['X-Twilio-Signature'] || '').trim();
  if (!sent) return {ok: false, reason: 'missing-signature'};
  const expected = signatureFor(token, requestUrl(req), paramsFromBody(rawBody));
  if (!safeEqual(sent, expected)) return {ok: false, reason: 'bad-signature'};
  return {ok: true};
}

module.exports = {authToken, requestUrl, signatureFor, paramsFromBody, verify};
