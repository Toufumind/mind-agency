import Link from 'next/link';
import { Mail, ArrowRight } from 'lucide-react';

interface AgentCardProps {
  name: string;
  emailCount: number;
}

const colors = [
  'from-indigo-400 to-purple-500',
  'from-emerald-400 to-teal-500',
  'from-orange-400 to-rose-500',
  'from-sky-400 to-cyan-500',
  'from-pink-400 to-fuchsia-500',
  'from-amber-400 to-yellow-500',
];

const colorIndex = (name: string) =>
  name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;

export default function AgentCard({ name, emailCount }: AgentCardProps) {
  const gradient = colors[colorIndex(name)];

  return (
    <Link
      href={`/agents/${name}`}
      className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow duration-200 group p-6 flex flex-col gap-4 hover:-translate-y-1 transition-all duration-200"
    >
      {/* 头像 */}
      <div className="flex items-center gap-4">
        <div
          className={`flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br ${gradient} text-white text-lg font-bold shadow-lg shadow-indigo-200/30`}
        >
          {name[0]}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-gray-900">{name}</h3>
          <p className="text-sm text-gray-500">Agent</p>
        </div>
      </div>

      {/* 统计 */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-50">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Mail size={15} />
          <span>
            {emailCount} 封邮件
            {emailCount > 0 && (
              <span className="ml-1 text-xs text-indigo-500 font-medium">
                (未读)
              </span>
            )}
          </span>
        </div>
        <ArrowRight
          size={16}
          className="text-gray-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all"
        />
      </div>
    </Link>
  );
}
