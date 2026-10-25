import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseApiStatus, parseSignalingGroups, parseSipServers, parseSystem } from "../lib/ribbon-xml";

const DETAILS = `<?xml version="1.0"?>
<root>
  <status><http_code>200</http_code></status>
  <sipsg id="1" href="https://sbc.example/rest/sipsg/1">
    <Description>PSTN Primary</Description>
    <customAdminState>1</customAdminState>
    <Channels>24</Channels>
    <ServerClusterId>3</ServerClusterId>
    <ListenPort_1>5060</ListenPort_1>
    <Protocol_1>1</Protocol_1>
    <InteropMode>0</InteropMode>
    <rt_Status>0</rt_Status>
    <rt_NumberOfChannels>24</rt_NumberOfChannels>
    <rt_NumCurrentCalls>4</rt_NumCurrentCalls>
  </sipsg>
  <sipsg id="4" href="https://sbc.example/rest/sipsg/4">
    <Description>Fax</Description>
    <customAdminState>0</customAdminState>
    <rt_Status>1</rt_Status>
    <Channels>4</Channels>
    <ServerClusterId>0</ServerClusterId>
  </sipsg>
</root>`;

describe("ribbon xml", () => {
  it("reads signaling group runtime status, admin state, and listeners", () => {
    const groups = parseSignalingGroups(DETAILS);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].name, "PSTN Primary");
    assert.equal(groups[0].health, "up");
    assert.equal(groups[0].statusLabel, "Up");
    assert.equal(groups[0].channels, 24);
    assert.equal(groups[0].currentCalls, 4);
    assert.equal(groups[0].protocol, "UDP 5060");
    assert.equal(groups[0].interop, "Standard");
    assert.equal(groups[0].serverClusterId, "3");
    assert.equal(groups[0].stub, false);
    assert.equal(groups[1].health, "disabled");
    assert.equal(groups[1].serverClusterId, "");
  });

  it("accepts symbolic status names and peer-down as down", () => {
    const xml = `<?xml version="1.0"?>
<root>
  <status><http_code>200</http_code></status>
  <resource>
    <sipsg id="9">
      <Description>Teams</Description>
      <customAdminState>cmCustomEnabled</customAdminState>
      <rt_Status>sgsUpPeersDown</rt_Status>
    </sipsg>
  </resource>
</root>`;
    const [group] = parseSignalingGroups(xml);
    assert.equal(group.health, "down");
    assert.equal(group.statusLabel, "Peers down");
    assert.equal(group.rawStatus, "sgsUpPeersDown");
  });

  it("marks href-only rows as stubs and keeps the id", () => {
    const xml = `<?xml version="1.0"?>
<root>
  <status><http_code>200</http_code></status>
  <sipsg_list>
    <sipsg id="7" href="https://sbc.example/rest/sipsg/7"/>
    <sipsg href="https://sbc.example/rest/sipsg/8"/>
  </sipsg_list>
</root>`;
    const groups = parseSignalingGroups(xml);
    assert.deepEqual(
      groups.map((group) => [group.id, group.stub]),
      [
        ["7", true],
        ["8", true],
      ],
    );
  });

  it("reads system identity and sip servers", () => {
    const system = parseSystem(`<?xml version="1.0"?>
<root><status><http_code>200</http_code></status>
<system>
  <NodeName>edge-01</NodeName>
  <rt_Software_Base_Version>12.3.1</rt_Software_Base_Version>
  <rt_Software_Base_BuildNumber>550</rt_Software_Base_BuildNumber>
</system></root>`);
    assert.equal(system.name, "edge-01");
    assert.equal(system.version, "12.3.1 build 550");
    const peers = parseSipServers(`<?xml version="1.0"?>
<root><sipserver id="1"><Host>sip.carrier.example</Host><Port>5060</Port></sipserver></root>`);
    assert.deepEqual(peers, ["sip.carrier.example:5060"]);
  });

  it("surfaces application error codes", () => {
    const status = parseApiStatus(`<?xml version="1.0"?>
<root><status><http_code>400</http_code>
<app_status href="/rest/sipsg"><app_status_entry code="20035" params=""/></app_status></status></root>`);
    assert.equal(status.httpCode, 400);
    assert.equal(status.appCode, "20035");
  });
});
