import { toyConstraints } from './constants.js';

const allowedToyMutationKeys = new Set(['name', 'image', 'likes']);
const allowedLikesMutationKeys = new Set(['likes']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateAllowedKeys(payload, allowedKeys) {
  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) return `Unexpected field: ${key}`;
  }

  return null;
}

export async function readJsonBody(request) {
  const text = await request.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    return Symbol.for('invalid-json');
  }
}

export function parseIdSegment(idSegment) {
  if (idSegment === null || typeof idSegment === 'undefined' || idSegment === '') {
    return { error: 'Toy id is required' };
  }

  const normalizedId = Number(idSegment);
  if (!Number.isInteger(normalizedId) || normalizedId < 1) {
    return { error: 'Toy id must be an integer greater than or equal to 1' };
  }

  return { id: normalizedId };
}

export function validateToyMutationBody(payload) {
  if (!isPlainObject(payload)) return 'Toy payload is required';

  const allowedKeyError = validateAllowedKeys(payload, allowedToyMutationKeys);
  if (allowedKeyError) return allowedKeyError;

  if (typeof payload.name === 'undefined') return 'Toy name is required';
  if (typeof payload.image === 'undefined') return 'Toy image is required';

  if (typeof payload.name !== 'string') return 'Toy name is required';
  const trimmedName = payload.name.trim();
  if (!trimmedName) return 'Toy name is required';
  if (trimmedName.length < toyConstraints.minNameLength) {
    return `Toy name must be at least ${toyConstraints.minNameLength} characters long`;
  }
  if (trimmedName.length > toyConstraints.maxNameLength) {
    return `Toy name must be at most ${toyConstraints.maxNameLength} characters long`;
  }

  if (typeof payload.image !== 'string' || !payload.image.trim()) {
    return 'Toy image is required';
  }

  try {
    const parsedImage = new URL(payload.image);
    if (!toyConstraints.imageProtocols.includes(parsedImage.protocol)) {
      return 'Toy image must be a valid URI';
    }
  } catch {
    return 'Toy image must be a valid URI';
  }

  if (typeof payload.likes !== 'undefined') {
    if (!Number.isInteger(payload.likes) || payload.likes < 0) {
      return 'Likes must be an integer greater than or equal to 0';
    }
  }

  return null;
}

export function validateLikeMutationBody(payload) {
  if (!isPlainObject(payload)) return 'Likes payload is required';

  const allowedKeyError = validateAllowedKeys(payload, allowedLikesMutationKeys);
  if (allowedKeyError) return allowedKeyError;

  if (!Object.prototype.hasOwnProperty.call(payload, 'likes')) {
    return 'Likes is required';
  }

  if (!Number.isInteger(payload.likes) || payload.likes < 0) {
    return 'Likes must be an integer greater than or equal to 0';
  }

  return null;
}
