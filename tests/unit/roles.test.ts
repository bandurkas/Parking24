import { test } from "node:test";
import assert from "node:assert/strict";
import { roleHome } from "@/lib/crm/roles";

test("roleHome: у каждой роли свой домашний экран", () => {
  assert.equal(roleHome("GUARD"), "/admin/today");
  assert.equal(roleHome("PARKER"), "/admin/parking-lot");
  assert.equal(roleHome("DRIVER"), "/admin/transfers");
  assert.equal(roleHome("OWNER"), "/admin");
  assert.equal(roleHome("ADMIN"), "/admin");
});
