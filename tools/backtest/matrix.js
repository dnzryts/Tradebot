const { run } = require('./bt');
const base = JSON.parse(process.argv[2] || '{}');
const cases = JSON.parse(require('fs').readFileSync(process.argv[3], 'utf8'));
for (const [name, cfg] of Object.entries(cases)) {
  const r = run({ ...base, ...cfg });
  const ex = Object.entries(r.exits).map(([k, v]) => `${k}:${v.n}/${v.R}`).join(' ');
  const ps = Object.entries(r.perSym).map(([k, v]) => `${k.slice(0,6)}:${v.R}`).join(' ');
  console.log(`${name.padEnd(28)} n=${String(r.trades).padStart(5)} win=${r.winRate}% net=${String(r.netR).padStart(7)}R pf=${r.pf} dd=${r.maxDdR} spread=${r.spreadCostR}R bars=${r.avgBars} | ${ex} | ${ps}`);
}
