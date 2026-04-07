/**
 * Security utilities for MovilCal.
 * Focuses on preventing XSS and other injection attacks.
 */

/**
 * Sanitizes a string to prevent XSS. 
 * Replaces dangerous characters with HTML entities.
 * @param {string} str - Raw input from user.
 * @param {number} maxLen - Optional max length.
 * @returns {string} - Clean string.
 */
export function sanitizeHTML(str, maxLen = 150) {
  if (!str) return '';
  
  // 1. Remove obvious script tags and event handlers
  let clean = String(str)
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "")
    .replace(/on\w+="[^"]*"/gim, "")
    .replace(/on\w+='[^']*'/gim, "");

  // 2. Convert special characters to entities
  const entities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&grave;'
  };

  clean = clean.replace(/[&<>"'/`]/g, s => entities[s]);

  // 3. Trim and Slice
  return clean.trim().slice(0, maxLen);
}

/**
 * Validates if a string is a potential SQL injection or has suspicious patterns.
 * (Simple pattern check for UI feedback)
 */
export function isSuspicious(str) {
  const patterns = [/DROP\s+TABLE/i, /UNION\s+SELECT/i, /<script/i, /OR\s+1=1/i];
  return patterns.some(p => p.test(str));
}
