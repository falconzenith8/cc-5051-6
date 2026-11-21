// 逐人对账：实际入场、等待与退票。可单场出账，也可两种放行模式并排出账。
import { CFG } from './fsim.js';

const sec = (t) => (t >= 0 ? +(t * CFG.dt).toFixed(1) : null);

export function reconcileOne(sim) {
  const rows = sim.agents.map((a) => {
    const batch = sim.batchOf(a.batchId);
    return {
      id: a.specId,
      team: a.team,
      batchId: a.batchId,
      slow: a.slow,
      appt: sec(batch.apptTick),
      called: sec(a.calledTick),
      admit: sec(a.admitTick),
      wait: a.admitted ? +((a.admitTick - a.calledTick) * CFG.dt).toFixed(1) : null,
      exit: sec(a.exitTick),
      refund: a.refunded ? sec(a.refundTick) : null,
      dest: a.done ? sim.venue.activeExit : null,
    };
  });
  rows.sort((a, b) => a.id - b.id);
  return rows;
}

// 两种放行模式并排：同一剧本（同种子）下，谁的入场被回执拖住、谁退了票
export function reconcileModes(simScheduled, simReceipt) {
  const A = reconcileOne(simScheduled);
  const B = reconcileOne(simReceipt);
  const rows = A.map((ra, i) => ({
    id: ra.id,
    team: ra.team,
    batchId: ra.batchId,
    appt: ra.appt,
    scheduled: { called: ra.called, admit: ra.admit, wait: ra.wait, refund: ra.refund },
    receipt: { called: B[i].called, admit: B[i].admit, wait: B[i].wait, refund: B[i].refund },
    destScheduled: ra.dest,
    destReceipt: B[i].dest,
  }));
  return rows;
}
