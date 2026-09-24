import { test } from "node:test";
import assert from "node:assert/strict";
import { userChangeError } from "@/lib/settings-validate";

const owner = { id: "o1", role: "OWNER" as const, isActive: true };
const admin = { id: "a1", role: "ADMIN" as const, isActive: true };

test("последнего действующего владельца нельзя выключить или понизить", () => {
  assert.match(userChangeError("o2", owner, { role: "OWNER", isActive: false }, 0) ?? "", /последний/);
  assert.match(userChangeError("o2", owner, { role: "ADMIN", isActive: true }, 0) ?? "", /последний/);
  assert.equal(userChangeError("o2", owner, { role: "OWNER", isActive: false }, 1), null);
});

test("над собой: выключить и сменить роль нельзя, имя — можно", () => {
  assert.match(userChangeError("o1", owner, { role: "OWNER", isActive: false }, 3) ?? "", /Себя/);
  assert.match(userChangeError("o1", owner, { role: "ADMIN", isActive: true }, 3) ?? "", /роль/);
  assert.equal(userChangeError("o1", owner, { role: "OWNER", isActive: true }, 0), null);
});

test("обычные правки чужих: выключить администратора, сделать водителя парковщиком", () => {
  assert.equal(userChangeError("o1", admin, { role: "ADMIN", isActive: false }, 0), null);
  assert.equal(userChangeError("o1", { id: "d1", role: "DRIVER", isActive: true }, { role: "PARKER", isActive: true }, 0), null);
});
