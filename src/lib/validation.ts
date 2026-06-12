/**
 * validation.ts — Input validation utilities
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate agent name
 */
export function validateAgentName(name: string): ValidationResult {
  const errors: string[] = [];

  if (!name) {
    errors.push('Agent name is required');
  } else {
    if (name.length > 50) {
      errors.push('Agent name must be 50 characters or less');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      errors.push('Agent name can only contain letters, numbers, underscores, and hyphens');
    }
    if (name.startsWith('.') || name.startsWith('-')) {
      errors.push('Agent name cannot start with . or -');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate group name
 */
export function validateGroupName(name: string): ValidationResult {
  const errors: string[] = [];

  if (!name) {
    errors.push('Group name is required');
  } else {
    if (name.length > 50) {
      errors.push('Group name must be 50 characters or less');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      errors.push('Group name can only contain letters, numbers, underscores, and hyphens');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate message content
 */
export function validateMessage(content: string): ValidationResult {
  const errors: string[] = [];

  if (!content) {
    errors.push('Message content is required');
  } else {
    if (content.length > 100000) {
      errors.push('Message content must be 100,000 characters or less');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate email address
 */
export function validateEmail(email: string): ValidationResult {
  const errors: string[] = [];

  if (!email) {
    errors.push('Email is required');
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      errors.push('Invalid email format');
    }
    if (email.length > 254) {
      errors.push('Email must be 254 characters or less');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate API key format
 */
export function validateApiKey(key: string): ValidationResult {
  const errors: string[] = [];

  if (key && key.length > 1000) {
    errors.push('API key is too long');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate URL
 */
export function validateUrl(url: string): ValidationResult {
  const errors: string[] = [];

  if (url) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push('URL must use http or https protocol');
      }
    } catch {
      errors.push('Invalid URL format');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate pagination parameters
 */
export function validatePagination(page?: number, limit?: number): {
  page: number;
  limit: number;
  offset: number;
} {
  const validPage = Math.max(1, page || 1);
  const validLimit = Math.min(100, Math.max(1, limit || 20));
  const offset = (validPage - 1) * validLimit;

  return { page: validPage, limit: validLimit, offset };
}

/**
 * Sanitize string for display (prevent XSS)
 */
export function sanitizeDisplay(str: string): string {
  if (!str) return '';

  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Sanitize filename
 */
export function sanitizeFilename(filename: string): string {
  if (!filename) return 'untitled';

  // Remove path separators and special characters
  let sanitized = filename
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .trim();

  // Limit length
  if (sanitized.length > 255) {
    const ext = sanitized.split('.').pop();
    sanitized = sanitized.slice(0, 255 - (ext ? ext.length + 1 : 0)) + (ext ? `.${ext}` : '');
  }

  return sanitized || 'untitled';
}

/**
 * Validate JSON string
 */
export function validateJson(str: string): ValidationResult {
  const errors: string[] = [];

  try {
    JSON.parse(str);
  } catch (e: any) {
    errors.push(`Invalid JSON: ${e.message}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate and parse request body
 */
export function parseRequestBody<T>(body: string | null): {
  data: T | null;
  error: string | null;
} {
  if (!body) {
    return { data: null, error: 'Request body is empty' };
  }

  try {
    const data = JSON.parse(body) as T;
    return { data, error: null };
  } catch (e: any) {
    return { data: null, error: `Invalid JSON: ${e.message}` };
  }
}
