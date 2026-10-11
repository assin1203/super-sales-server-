/** 从 Authorization 头提取 Bearer token（缺失/格式错误返回 null） */
export function extractBearer(req: { headers?: Record<string, unknown> }): string | null {
  const h = req.headers?.authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ')) {
    const token = h.slice(7).trim();
    return token.length > 0 ? token : null;
  }
  return null;
}
