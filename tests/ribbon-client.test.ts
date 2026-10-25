import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { RibbonClient } from "../lib/ribbon-client";

const INDEX = `<?xml version="1.0"?>
<root>
  <status><http_code>200</http_code></status>
  <sipsg_list>
    <sipsg id="1" href="/rest/sipsg/1"/>
  </sipsg_list>
</root>`;

const GROUP = `<?xml version="1.0"?>
<root>
  <status><http_code>200</http_code></status>
  <sipsg id="1" href="/rest/sipsg/1">
    <Description>PSTN Primary</Description>
    <customAdminState>1</customAdminState>
    <ServerClusterId>3</ServerClusterId>
    <ListenPort_1>5060</ListenPort_1>
    <Protocol_1>1</Protocol_1>
    <rt_Status>1</rt_Status>
    <rt_NumberOfChannels>24</rt_NumberOfChannels>
    <rt_NumCurrentCalls>0</rt_NumCurrentCalls>
  </sipsg>
</root>`;

const SERVERS = `<?xml version="1.0"?>
<root>
  <status><http_code>200</http_code></status>
  <sipserver id="1"><Host>sip.carrier.example</Host><Port>5060</Port></sipserver>
</root>`;

const SYSTEM = `<?xml version="1.0"?>
<root>
  <status><http_code>200</http_code></status>
  <system><NodeName>edge-01</NodeName><rt_Software_Base_Version>12.3.1</rt_Software_Base_Version></system>
</root>`;

async function listen(): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/rest/login") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk as Buffer));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (!body.includes("Username=restuser") || !body.includes("Password=secret")) {
          response.writeHead(401);
          response.end("no");
          return;
        }
        response.writeHead(200, {
          "Content-Type": "text/xml",
          "Set-Cookie": "PHPSESSID=abc123; path=/; secure",
        });
        response.end(`<?xml version="1.0"?><root><status><http_code>200</http_code></status></root>`);
      });
      return;
    }
    if (!request.headers.cookie?.includes("PHPSESSID=abc123")) {
      response.writeHead(401);
      response.end("no session");
      return;
    }
    response.setHeader("Content-Type", "text/xml");
    if (url.pathname === "/rest/sipsg") response.end(INDEX);
    else if (url.pathname === "/rest/sipsg/1") response.end(GROUP);
    else if (url.pathname === "/rest/system") response.end(SYSTEM);
    else if (url.pathname.startsWith("/rest/sipservertable/")) response.end(SERVERS);
    else {
      response.writeHead(404);
      response.end("missing");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}/rest` };
}

describe("RibbonClient", () => {
  it("logs in, follows signaling-group links, and reads peers", async () => {
    const { server, url } = await listen();
    try {
      const client = new RibbonClient({
        baseUrl: url,
        username: "restuser",
        password: "secret",
        tlsVerify: false,
      });
      const system = await client.getSystem();
      const trunks = await client.getSignalingGroups();
      assert.equal(system.name, "edge-01");
      assert.equal(trunks.length, 1);
      assert.equal(trunks[0].name, "PSTN Primary");
      assert.equal(trunks[0].health, "down");
      assert.equal(trunks[0].statusLabel, "Down");
      assert.deepEqual(trunks[0].peers, ["sip.carrier.example:5060"]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("rejects a bad REST password", async () => {
    const { server, url } = await listen();
    try {
      const client = new RibbonClient({
        baseUrl: url,
        username: "restuser",
        password: "nope",
        tlsVerify: false,
      });
      await assert.rejects(() => client.getSystem(), /REST access level/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
