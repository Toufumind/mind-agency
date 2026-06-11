'use client';

import dynamic from 'next/dynamic';
// remarkGfm is only ~3KB — keep it eager so the plugin loads
import remarkGfm from 'remark-gfm';

const ReactMarkdown = dynamic(() => import('react-markdown'), { ssr: false });

const mdComponents = {
  code({ className, children, ...props }: any) {
    if (!className) return <code className="bg-destructive-muted text-destructive px-1.5 py-0.5 rounded text-[12px]" {...props}>{children}</code>;
    return <pre className="bg-surface border border-border rounded-xl p-4 my-2 overflow-x-auto text-[13px] leading-relaxed"><code className={className} {...props}>{children}</code></pre>;
  },
  p({ children }: any) { return <p className="my-0.5 leading-relaxed">{children}</p>; },
  ul({ children }: any) { return <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>; },
  li({ children }: any) { return <li className="text-[14px] text-muted">{children}</li>; },
  a({ children, href }: any) { return <a href={href} className="text-foreground underline underline-offset-2" target="_blank">{children}</a>; },
  blockquote({ children }: any) { return <blockquote className="border-l-2 border-border pl-3 my-2 text-muted-foreground">{children}</blockquote>; },
  h2({ children }: any) { return <h2 className="text-[15px] font-semibold text-foreground mt-3 mb-1">{children}</h2>; },
  h3({ children }: any) { return <h3 className="text-[14px] font-semibold text-foreground mt-2 mb-1">{children}</h3>; },
  strong({ children }: any) { return <strong className="font-semibold text-foreground">{children}</strong>; },
  em({ children }: any) { return <em className="italic">{children}</em>; },
};

export default function Markdown({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="text-[14px] text-muted leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{text}</ReactMarkdown>
    </div>
  );
}
