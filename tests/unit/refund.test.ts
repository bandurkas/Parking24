import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRefund, refundLimit } from "@/lib/refund";

const STATUSES = ["NEW", "AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW", "REJECTED"];
const out = (amount: number, paid: number) => ({ status: "CHECKED_OUT", amount, paid });

test("applyRefund: «Выехал» — сначала переплата, остаток уменьшает сумму", () => {
  assert.deepEqual(applyRefund(out(350, 1050), 700), { amount: 350, paid: 350, over: 700, cut: 0 });
  assert.deepEqual(applyRefund(out(1050, 1400), 350), { amount: 1050, paid: 1050, over: 350, cut: 0 });
  assert.deepEqual(applyRefund(out(1050, 1050), 350), { amount: 700, paid: 700, over: 0, cut: 350 });
  assert.deepEqual(applyRefund(out(1050, 1200), 350), { amount: 850, paid: 850, over: 150, cut: 200 });
  assert.deepEqual(applyRefund(out(0, 5000), 5000), { amount: 0, paid: 0, over: 5000, cut: 0 });
});

test("applyRefund: до выезда и у отменённых сумма брони не меняется — долг возвращается", () => {
  assert.deepEqual(applyRefund({ status: "CONFIRMED", amount: 1050, paid: 1050 }, 1050), { amount: 1050, paid: 0, over: 0, cut: 0 });
  assert.deepEqual(applyRefund({ status: "CHECKED_IN", amount: 700, paid: 1050 }, 350), { amount: 700, paid: 700, over: 350, cut: 0 });
  assert.deepEqual(applyRefund({ status: "CANCELLED", amount: 1050, paid: 1050 }, 700), { amount: 1050, paid: 350, over: 0, cut: 0 });
});

test("applyRefund: больше оплаченного, ноль и без оплаты — нельзя", () => {
  for (const status of STATUSES) {
    assert.equal(applyRefund({ status, amount: 1050, paid: 700 }, 800), null, status);
    assert.equal(applyRefund({ status, amount: 1050, paid: 700 }, 0), null, status);
    assert.equal(applyRefund({ status, amount: 1050, paid: 700 }, -1), null, status);
    assert.equal(applyRefund({ status, amount: 1050, paid: 0 }, 1), null, status);
    assert.equal(applyRefund({ status, amount: 1050, paid: 700 }, Number.NaN), null, status);
  }
});

test("applyRefund перебором: «не оплачено» у «Выехал» не меняется, у остальных сумма та же, ничего не уходит в минус", () => {
  const due = (a: number, p: number) => Math.max(0, a - p);
  for (const status of STATUSES) {
    for (let amount = 0; amount <= 2000; amount += 50) {
      for (let paid = 50; paid <= 2000; paid += 50) {
        for (let refund = 1; refund <= paid; refund += 49) {
          const r = applyRefund({ status, amount, paid }, refund)!;
          assert.ok(r, `${status} ${amount}/${paid} −${refund}`);
          assert.ok(r.amount >= 0 && r.paid >= 0);
          assert.equal(r.paid, paid - refund);
          if (status === "CHECKED_OUT") {
            assert.equal(due(r.amount, r.paid), due(amount, paid));
            assert.equal(r.cut, Math.max(0, refund - Math.max(0, paid - amount)));
          } else {
            assert.equal(r.amount, amount);
            assert.equal(r.cut, 0);
          }
        }
      }
    }
  }
});

test("refundLimit: после выезда администратор — только переплата, владелец — всё оплаченное", () => {
  assert.equal(refundLimit(out(350, 1050), false), 700);
  assert.equal(refundLimit(out(1050, 1050), false), 0);
  assert.equal(refundLimit(out(1050, 700), false), 0);
  assert.equal(refundLimit(out(1050, 1050), true), 1050);
  for (const status of STATUSES.filter((s) => s !== "CHECKED_OUT")) {
    assert.equal(refundLimit({ status, amount: 1050, paid: 700 }, false), 700, status);
    assert.equal(refundLimit({ status, amount: 1050, paid: 700 }, true), 700, status);
  }
});

test("refundLimit согласован с applyRefund: в пределе у администратора сумма «Выехал» не уменьшается", () => {
  for (let amount = 0; amount <= 1500; amount += 50) {
    for (let paid = 50; paid <= 1500; paid += 50) {
      const lim = refundLimit(out(amount, paid), false);
      if (lim > 0) assert.equal(applyRefund(out(amount, paid), lim)!.cut, 0);
      if (lim + 1 <= paid) assert.ok(applyRefund(out(amount, paid), lim + 1)!.cut > 0);
    }
  }
});
