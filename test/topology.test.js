import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicTopology } from "../src/routes/topology.js";

test("filters public topology", () => {
  const out = buildPublicTopology({ owner:"AtlasReaper311", canonical_site:"https://atlas-systems.uk", components:[
    {name:"atlas-runtime",kind:"worker",lifecycle:"production",repo:"https://github.com/AtlasReaper311/atlas-runtime"},
    {name:"atlas-tool",kind:"tool",lifecycle:"production",repo:"https://github.com/AtlasReaper311/atlas-tool"},
    {name:"private",kind:"worker",lifecycle:"internal",repo:"https://github.com/AtlasReaper311/private"},
    {name:"simple-proxy",kind:"worker",lifecycle:"production",repo:"https://github.com/AtlasReaper311/simple-proxy"}
  ]});
  assert.deepEqual(out.components.map((x)=>x.id), ["atlas-runtime","atlas-tool"]);
});
