'use client';

import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/sidebar';
import { DollarSign, Send, TrendingUp, Users, ArrowUpDown } from 'lucide-react';
import { useT } from '@/components/i18n';

interface AgentAccount {
  agent: string;
  balance: number;
  earned: number;
  spent: number;
  transactions: any[];
}

export default function EconomyPage() {
  const { t } = useT();
  const [accounts, setAccounts] = useState<AgentAccount[]>([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositReason, setDepositReason] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [msg, setMsg] = useState('');
  const [relayLogs, setRelayLogs] = useState<any[]>([]);
  const [relayStats, setRelayStats] = useState({ totalCost: 0, totalCalls: 0, byAgent: {} as Record<string, any> });

  const load = useCallback(async () => {
    // Fetch agent list from API
    let agentNames: string[] = [];
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      agentNames = (data.agents || []).map((a: any) => a.name);
    } catch (e) { console.error('[app:economy:page]', e); }

    // Fallback if API fails
    if (agentNames.length === 0) agentNames = ['me'];

    // Fetch all agent accounts (use Next.js API, not port 3001)
    const results: AgentAccount[] = [];
    for (const agent of agentNames) {
      try {
        const res = await fetch(`/api/economy/account?agent=${agent}`);
        const data = await res.json();
        if (data.account) results.push(data.account);
      } catch (e) { console.error('[app:economy:page]', e); }
    }
    setAccounts(results);

    // Load relay logs
    try {
      const res = await fetch('/api/relay?limit=50');
      const data = await res.json();
      setRelayLogs(data.logs || []);
      setRelayStats({ totalCost: data.totalCost || 0, totalCalls: data.totalCalls || 0, byAgent: data.byAgent || {} });
    } catch (e) { console.error('[app:economy:page]', e); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const doDeposit = async () => {
    if (!selectedAgent || !depositAmount) return;
    try {
      await fetch('/api/economy/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: selectedAgent, amount: Number(depositAmount), from: 'me', reason: depositReason || '用户充值' }),
      });
      setMsg(`✅ 已给 ${selectedAgent} 充值 ${depositAmount} tokens`);
      setDepositAmount(''); setDepositReason('');
      load();
    } catch (e: any) { setMsg(`❌ 失败: ${e.message}`); }
  };

  const doTransfer = async () => {
    if (!transferTo || !transferAmount) return;
    try {
      const res = await fetch('/api/economy/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'me', to: transferTo, amount: Number(transferAmount), reason: transferReason || '用户转账' }),
      });
      const data = await res.json();
      if (data.ok) {
        setMsg(`✅ 已转账 ${transferAmount} tokens 给 ${transferTo}`);
        setTransferTo(''); setTransferAmount(''); setTransferReason('');
        load();
      } else {
        setMsg(`❌ 余额不足`);
      }
    } catch (e: any) { setMsg(`❌ 失败: ${e.message}`); }
  };

  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);
  const totalEarned = accounts.reduce((s, a) => s + a.earned, 0);

  return (
    <div className="flex h-full bg-canvas overflow-hidden"><Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-10">
          <h1 className="text-[18px] font-semibold text-foreground mb-1 flex items-center gap-2">
            <DollarSign size={18} className="text-muted-foreground"/> Token 经济
          </h1>
          <p className="text-[12px] text-muted-foreground mb-6">管理 Agent 的 Token 余额和交易</p>

          {msg && <div className="mb-4 p-3 bg-surface border border-border rounded-lg text-[13px]">{msg}</div>}

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-canvas border border-border rounded-xl p-4 text-center">
              <p className="text-[24px] font-bold text-foreground">{totalBalance.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground mt-1">总余额</p>
            </div>
            <div className="bg-canvas border border-border rounded-xl p-4 text-center">
              <p className="text-[24px] font-bold text-foreground">{totalEarned.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground mt-1">总发行</p>
            </div>
            <div className="bg-canvas border border-border rounded-xl p-4 text-center">
              <p className="text-[24px] font-bold text-foreground">{accounts.length}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Agent 数量</p>
            </div>
          </div>

          {/* Agent balances */}
          <div className="mb-8">
            <h2 className="text-[14px] font-semibold text-foreground mb-3 flex items-center gap-2"><Users size={14}/> Agent 余额</h2>
            <div className="space-y-2">
              {accounts.map(acc => (
                <div key={acc.agent} className="flex items-center justify-between bg-canvas border border-border rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full bg-surface flex items-center justify-center text-[12px] font-medium">{acc.agent[0]}</span>
                    <div>
                      <p className="text-[13px] font-medium text-foreground">{acc.agent}</p>
                      <p className="text-[10px] text-muted-foreground">收入 {acc.earned} · 支出 {acc.spent}</p>
                    </div>
                  </div>
                  <span className="text-[16px] font-bold text-foreground font-mono">{acc.balance.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Relay Stats */}
          {relayStats.totalCalls > 0 && (
            <div className="mb-8">
              <h2 className="text-[14px] font-semibold text-foreground mb-3 flex items-center gap-2"><TrendingUp size={14}/> 中转站统计</h2>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-canvas border border-border rounded-xl p-4 text-center">
                  <p className="text-[20px] font-bold text-foreground">{relayStats.totalCalls}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">总调用</p>
                </div>
                <div className="bg-canvas border border-border rounded-xl p-4 text-center">
                  <p className="text-[20px] font-bold text-foreground">¥{relayStats.totalCost.toFixed(4)}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">总消耗</p>
                </div>
                <div className="bg-canvas border border-border rounded-xl p-4 text-center">
                  <p className="text-[20px] font-bold text-foreground">{Object.keys(relayStats.byAgent).length}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">活跃 Agent</p>
                </div>
              </div>
              {/* Per-agent breakdown */}
              <div className="bg-canvas border border-border rounded-xl overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead><tr className="border-b border-border bg-surface">
                    <th className="text-left px-4 py-2 font-medium">Agent</th>
                    <th className="text-right px-4 py-2 font-medium">调用</th>
                    <th className="text-right px-4 py-2 font-medium">输入</th>
                    <th className="text-right px-4 py-2 font-medium">输出</th>
                    <th className="text-right px-4 py-2 font-medium">消耗</th>
                  </tr></thead>
                  <tbody>
                    {Object.entries(relayStats.byAgent).map(([agent, stats]: [string, any]) => (
                      <tr key={agent} className="border-b border-border/50 last:border-0">
                        <td className="px-4 py-2 font-medium">{agent}</td>
                        <td className="text-right px-4 py-2 font-mono">{stats.calls}</td>
                        <td className="text-right px-4 py-2 font-mono">{stats.tokensIn.toLocaleString()}</td>
                        <td className="text-right px-4 py-2 font-mono">{stats.tokensOut.toLocaleString()}</td>
                        <td className="text-right px-4 py-2 font-mono">¥{stats.cost.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Deposit */}
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-canvas border border-border rounded-xl p-5">
              <h3 className="text-[13px] font-semibold text-foreground mb-3 flex items-center gap-2"><DollarSign size={14}/> 充值</h3>
              <div className="space-y-3">
                <select value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-[13px]">
                  <option value="">选择 Agent</option>
                  {accounts.map(a => <option key={a.agent} value={a.agent}>{a.agent}</option>)}
                </select>
                <input type="number" value={depositAmount} onChange={e => setDepositAmount(e.target.value)}
                  placeholder="数量" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-[13px]" />
                <input value={depositReason} onChange={e => setDepositReason(e.target.value)}
                  placeholder="原因（可选）" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-[13px]" />
                <button onClick={doDeposit} className="w-full py-2 bg-foreground text-canvas rounded-lg text-[13px] font-medium hover:opacity-90">充值</button>
              </div>
            </div>

            <div className="bg-canvas border border-border rounded-xl p-5">
              <h3 className="text-[13px] font-semibold text-foreground mb-3 flex items-center gap-2"><ArrowUpDown size={14}/> 转账</h3>
              <div className="space-y-3">
                <input value={transferTo} onChange={e => setTransferTo(e.target.value)}
                  placeholder="转给谁" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-[13px]" />
                <input type="number" value={transferAmount} onChange={e => setTransferAmount(e.target.value)}
                  placeholder="数量" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-[13px]" />
                <input value={transferReason} onChange={e => setTransferReason(e.target.value)}
                  placeholder="原因（可选）" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-[13px]" />
                <button onClick={doTransfer} className="w-full py-2 bg-foreground text-canvas rounded-lg text-[13px] font-medium hover:opacity-90">转账</button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
