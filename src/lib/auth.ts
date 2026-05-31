import crypto from 'crypto';

export interface User {
  id: string;
  username: string;
  hash: string;
  salt: string;
}

/*
 * TODO: 接入真实数据库后需改进以下两点 (Bob Review 2026-05-31):
 *   1. 为每个用户生成独立随机 salt (crypto.randomBytes(16))
 *   2. PBKDF2 迭代次数提升至 OWASP 标准 210,000+
 *   3. 考虑迁移到 Argon2id
 *
 * 当前 mock 阶段暂时保留现状。
 */

/** 模拟用户数据库（实际项目中应替换为真实数据库） */
const USERS: User[] = [
  // 示例用户: 密码为 "admin123"
  {
    id: '1',
    username: 'admin',
    hash: 'cd4b7302bb0c74940b63d709b43de9dd17c332dc716c74815afb07a7bdf3dafe72f96401dcc33b590a4cddc1dcfd7820dd50377bde07da0689463458494a2b00',
    salt: 'default-salt', // TODO: 生产环境使用独立随机 salt
  },
  {
    id: '2',
    username: 'alice',
    hash: 'cd4b7302bb0c74940b63d709b43de9dd17c332dc716c74815afb07a7bdf3dafe72f96401dcc33b590a4cddc1dcfd7820dd50377bde07da0689463458494a2b00',
    salt: 'default-salt',
  },
  {
    id: '3',
    username: 'bob',
    hash: 'cd4b7302bb0c74940b63d709b43de9dd17c332dc716c74815afb07a7bdf3dafe72f96401dcc33b590a4cddc1dcfd7820dd50377bde07da0689463458494a2b00',
    salt: 'default-salt',
  },
  {
    id: '4',
    username: 'charlie',
    hash: 'cd4b7302bb0c74940b63d709b43de9dd17c332dc716c74815afb07a7bdf3dafe72f96401dcc33b590a4cddc1dcfd7820dd50377bde07da0689463458494a2b00',
    salt: 'default-salt',
  },
  {
    id: '5',
    username: 'david',
    hash: 'cd4b7302bb0c74940b63d709b43de9dd17c332dc716c74815afb07a7bdf3dafe72f96401dcc33b590a4cddc1dcfd7820dd50377bde07da0689463458494a2b00',
    salt: 'default-salt',
  },
  {
    id: '6',
    username: 'eve',
    hash: 'cd4b7302bb0c74940b63d709b43de9dd17c332dc716c74815afb07a7bdf3dafe72f96401dcc33b590a4cddc1dcfd7820dd50377bde07da0689463458494a2b00',
    salt: 'default-salt',
  },
  {
    id: '7',
    username: 'frank',
    hash: 'cd4b7302bb0c74940b63d709b43de9dd17c332dc716c74815afb07a7bdf3dafe72f96401dcc33b590a4cddc1dcfd7820dd50377bde07da0689463458494a2b00',
    salt: 'default-salt',
  },
];

/** Dummy 值 — 用于用户不存在时仍执行哈希计算，防止时序侧信道用户名枚举 */
const DUMMY_SALT = 'dummy-salt-for-timing-side-channel-mitigation';
const DUMMY_HASH = 'dummy-hash-for-timing-side-channel-mitigation';

export class AuthService {
  /**
   * 根据用户名查找用户
   * 返回 undefined 如果用户不存在
   */
  static findUser(username: string): User | undefined {
    return USERS.find(u => u.username === username);
  }

  /**
   * 模糊搜索用户
   *
   * 根据查询字符串对用户名进行模糊匹配（不区分大小写）。
   * q 为空时返回全部用户。
   * 返回用户列表，不包含敏感字段（hash, salt）。
   */
  static searchUsers(q: string): Omit<User, 'hash' | 'salt'>[] {
    const query = (q || '').toLowerCase().trim();

    const matched = query
      ? USERS.filter(u => u.username.toLowerCase().includes(query))
      : USERS;

    return matched.map(({ hash: _h, salt: _s, ...safe }) => safe);
  }

  /**
   * 验证密码
   *
   * 安全设计 (2026-05-31 Bob Review):
   *   - 无论用户是否存在，始终执行完整哈希计算，防止时序侧信道用户名枚举
   *   - 使用 crypto.timingSafeEqual 恒定时间比较
   *   - try-catch 兜底 timingSafeEqual，防止不同 Buffer 长度导致崩溃
   *
   * 原 Bug: TypeError: Cannot read property hash of undefined
   * 根因: 未检查 findUser() 返回值是否为 undefined 就访问 user.hash
   */
  static verifyPassword(username: string, password: string): boolean {
    const user = AuthService.findUser(username);

    // 无论用户是否存在，始终执行哈希计算
    // 使用真实 salt/hash 或 dummy 值，消除执行路径分支
    const salt = user?.salt ?? DUMMY_SALT;
    const storedHash = user?.hash ?? DUMMY_HASH;

    const hash = crypto
      .pbkdf2Sync(password, salt, 1000, 64, 'sha512')
      .toString('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(hash),
        Buffer.from(storedHash)
      );
    } catch {
      // Buffer 长度不一致时安全降级返回 false
      // 不会在正常流程中触发（hash 长度固定为 64 bytes → 128 hex chars）
      return false;
    }
  }
}
