export function getClientKey(request) {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim()) {
    return cfConnectingIp.trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }

  return 'unknown';
}

export function normalizePath(pathname) {
  if (!pathname || pathname === '/') return '/';

  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}
