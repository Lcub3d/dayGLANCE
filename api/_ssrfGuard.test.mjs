import { describe, it, expect, vi, afterEach } from 'vitest';
import dns from 'node:dns';
import http from 'node:http';
import zlib from 'node:zlib';
import { classifyAddress, assertSafeUrl, safeRequest, SsrfError } from './_ssrfGuard.mjs';

// Issue #1664's claim under test, in two halves:
//
//   1. The `always` set is refused whatever the deployment, so the self-hosted
//      image stops being reachable at the cloud metadata endpoint.
//   2. With allowPrivate on, EVERY address a self-hoster actually uses still
//      resolves — LAN, Docker host, Tailscale, loopback, ULA. That is the whole
//      "no user impact" argument for turning the guard on in the Docker proxy,
//      so it is pinned here rather than left to review.
//
// Before this, none of the four proxies had any test coverage at all.

const resolveTo = (...addresses) =>
  vi.spyOn(dns.promises, 'lookup').mockResolvedValue(
    addresses.map((a) => ({ address: a, family: a.includes(':') ? 6 : 4 })),
  );

afterEach(() => { vi.restoreAllMocks(); });

describe('classifyAddress', () => {
  const always = [
    ['0.0.0.0', 4], ['0.1.2.3', 4],
    ['169.254.169.254', 4],           // the cloud metadata endpoint
    ['192.0.0.1', 4],                 // IETF protocol assignments
    ['198.18.0.1', 4], ['198.19.255.255', 4], // benchmarking
    ['224.0.0.1', 4], ['239.255.255.255', 4], // multicast
    ['240.0.0.1', 4], ['255.255.255.255', 4], // reserved
    ['::', 6], ['fe80::1', 6], ['ff02::1', 6],
  ];
  const priv = [
    ['10.0.0.5', 4], ['172.16.0.1', 4], ['172.31.255.254', 4], ['192.168.1.10', 4],
    ['127.0.0.1', 4], ['127.1.2.3', 4],
    ['100.64.0.1', 4], ['100.127.255.255', 4], // CGNAT / Tailscale
    ['::1', 6], ['fd00::1', 6], ['fd7a:115c:a1e0::1', 6],
  ];
  const ok = [
    ['8.8.8.8', 4], ['172.15.0.1', 4], ['172.32.0.1', 4],
    ['100.63.255.255', 4], ['100.128.0.0', 4],
    ['2606:4700::1111', 6],
  ];

  it.each(always)('classifies %s as always-blocked', (ip, family) => {
    expect(classifyAddress(ip, family)).toBe('always');
  });

  it.each(priv)('classifies %s as private (grantable by a self-host)', (ip, family) => {
    expect(classifyAddress(ip, family)).toBe('private');
  });

  it.each(ok)('classifies %s as ok', (ip, family) => {
    expect(classifyAddress(ip, family)).toBe('ok');
  });

  it('sees through IPv4-mapped IPv6 in both the dotted and hex forms', () => {
    // dns.lookup emits the compressed hex form, so missing it would leave the
    // metadata endpoint reachable through a v6-looking literal.
    expect(classifyAddress('::ffff:169.254.169.254', 6)).toBe('always');
    expect(classifyAddress('::ffff:a9fe:a9fe', 6)).toBe('always');
    expect(classifyAddress('::ffff:127.0.0.1', 6)).toBe('private');
    expect(classifyAddress('::ffff:7f00:1', 6)).toBe('private');
    // A PUBLIC address in mapped form stays ok rather than being lumped in.
    expect(classifyAddress('::ffff:8.8.8.8', 6)).toBe('ok');
  });
});

describe('assertSafeUrl — hosted posture (allowPrivate off)', () => {
  it('allows a public target', async () => {
    resolveTo('203.0.113.10');
    await expect(assertSafeUrl('https://dav.example.com/x')).resolves.toMatchObject({
      addresses: [{ address: '203.0.113.10', family: 4 }],
    });
  });

  it('refuses a public hostname that resolves into private space', async () => {
    // The attack the resolve-then-check order exists for.
    resolveTo('10.0.0.5');
    await expect(assertSafeUrl('https://evil.example.com/')).rejects.toThrow(SsrfError);
  });

  it('refuses when only ONE of several records is disallowed', async () => {
    resolveTo('203.0.113.10', '169.254.169.254');
    await expect(assertSafeUrl('https://mixed.example.com/')).rejects.toThrow(SsrfError);
  });

  it('refuses encoded IPv4 literals, which the URL parser canonicalises', async () => {
    const spy = vi.spyOn(dns.promises, 'lookup')
      .mockImplementation(async (host) => [{ address: host, family: 4 }]);
    for (const encoded of ['http://0x7f000001/', 'http://2130706433/', 'http://0177.0.0.1/']) {
      await expect(assertSafeUrl(encoded)).rejects.toThrow(SsrfError);
    }
    expect(spy).toHaveBeenCalledWith('127.0.0.1', { all: true });
  });

  it('refuses a non-http(s) scheme and a malformed URL without resolving', async () => {
    const spy = vi.spyOn(dns.promises, 'lookup');
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow(SsrfError);
    await expect(assertSafeUrl('not a url')).rejects.toThrow(SsrfError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports a DNS failure and an empty answer as 502, not as allowed', async () => {
    vi.spyOn(dns.promises, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertSafeUrl('https://nope.example.com/')).rejects.toMatchObject({ status: 502 });

    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([]);
    await expect(assertSafeUrl('https://empty.example.com/')).rejects.toMatchObject({ status: 502 });
  });

  it('carries 403 for a blocked address, so callers can tell it from a bad URL', async () => {
    resolveTo('192.168.1.10');
    await expect(assertSafeUrl('https://nas.example.com/')).rejects.toMatchObject({ status: 403 });
    await expect(assertSafeUrl('ftp://x.example.com/')).rejects.toMatchObject({ status: 400 });
  });
});

describe('assertSafeUrl — self-hosted posture (allowPrivate on)', () => {
  // This block IS the "no user impact" claim from #1664. Every address a
  // self-hoster plausibly points the Docker proxy at must still resolve.
  const reachable = [
    ['a NAS on the LAN', '192.168.1.50'],
    ['a Docker host on 10/8', '10.1.2.3'],
    ['the Docker bridge', '172.17.0.1'],
    ['a Tailscale node', '100.101.102.103'],
    ['the same machine', '127.0.0.1'],
    ['a ULA v6 host', 'fd00::1'],
    ['a public host', '203.0.113.10'],
  ];

  it.each(reachable)('still reaches %s (%s)', async (_label, address) => {
    resolveTo(address);
    await expect(assertSafeUrl('https://target.example.com/', { allowPrivate: true }))
      .resolves.toBeTruthy();
  });

  const stillRefused = [
    ['the cloud metadata endpoint', '169.254.169.254'],
    ['multicast', '224.0.0.1'],
    ['reserved space', '240.0.0.1'],
    ['benchmarking space', '198.18.0.1'],
    ['the unspecified address', '0.0.0.0'],
  ];

  it.each(stillRefused)('still refuses %s (%s) even here', async (_label, address) => {
    resolveTo(address);
    await expect(assertSafeUrl('https://target.example.com/', { allowPrivate: true }))
      .rejects.toThrow(SsrfError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// safeRequest: the two holes that stay open if a validated URL is then handed
// to global fetch. Both were live in all four proxies before this, and the
// redirect one was demonstrated against a running server: a 302 from an allowed
// address to a blocked one returned the blocked server's body.
//
// These run against real loopback servers rather than mocks, because what is
// under test is what the transport actually does with a 3xx and with a socket,
// which a mocked dns.lookup cannot show.
// ─────────────────────────────────────────────────────────────────────────────
describe('safeRequest', () => {
  let servers = [];
  const listen = (handler, host = '127.0.0.1') => new Promise((resolve) => {
    const s = http.createServer(handler).listen(0, host, () => {
      servers.push(s);
      resolve(s.address().port);
    });
  });

  afterEach(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    servers = [];
  });

  it('follows a redirect to an allowed address, as fetch did', async () => {
    const dest = await listen((_q, s) => { s.writeHead(200); s.end('ARRIVED'); });
    const src = await listen((_q, s) => {
      s.writeHead(302, { Location: `http://127.0.0.1:${dest}/next` }); s.end();
    });
    const res = await safeRequest(`http://127.0.0.1:${src}/`, { allowPrivate: true });
    expect(res.body).toBe('ARRIVED');
    expect(res.status).toBe(200);
  });

  it('REFUSES a redirect into a blocked address', async () => {
    // 0.0.0.0 is in the always-blocked set and on Linux lands on loopback, so a
    // server can actually answer there — which is what made the old behaviour
    // demonstrable rather than theoretical.
    const secret = await listen((_q, s) => { s.writeHead(200); s.end('SECRET'); }, '0.0.0.0');
    const src = await listen((_q, s) => {
      s.writeHead(302, { Location: `http://0.0.0.0:${secret}/x` }); s.end();
    });
    await expect(safeRequest(`http://127.0.0.1:${src}/`, { allowPrivate: true }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('bounds a redirect loop instead of hanging', async () => {
    let port;
    port = await listen((_q, s) => {
      s.writeHead(302, { Location: `http://127.0.0.1:${port}/loop` }); s.end();
    });
    await expect(safeRequest(`http://127.0.0.1:${port}/`, { allowPrivate: true }))
      .rejects.toThrow(/Too many redirects/);
  });

  it('turns a 303 into a bodyless GET, matching fetch', async () => {
    const dest = await listen((q, s) => {
      let d = ''; q.on('data', (c) => { d += c; });
      q.on('end', () => { s.writeHead(200); s.end(`${q.method}|${d}`); });
    });
    const src = await listen((_q, s) => {
      s.writeHead(303, { Location: `http://127.0.0.1:${dest}/after` }); s.end();
    });
    const res = await safeRequest(`http://127.0.0.1:${src}/`, {
      method: 'POST', body: 'x=1', allowPrivate: true,
    });
    expect(res.body).toBe('GET|');
  });

  it('forwards method, body and headers, and returns response headers', async () => {
    const port = await listen((q, s) => {
      let d = ''; q.on('data', (c) => { d += c; });
      q.on('end', () => {
        s.writeHead(200, { ETag: 'W/"t1"', 'Content-Type': 'text/xml' });
        s.end(`${q.method}|${d}|${q.headers.authorization || '-'}|${q.headers.depth || '-'}`);
      });
    });
    const res = await safeRequest(`http://127.0.0.1:${port}/`, {
      method: 'PROPFIND',
      headers: { Authorization: 'Basic abc', Depth: '1' },
      body: '<propfind/>',
      allowPrivate: true,
    });
    expect(res.body).toBe('PROPFIND|<propfind/>|Basic abc|1');
    expect(res.headers.etag).toBe('W/"t1"');
    expect(res.headers['content-type']).toBe('text/xml');
  });

  it('decompresses gzip, so switching off fetch does not return bytes as text', async () => {
    const port = await listen((_q, s) => {
      s.writeHead(200, { 'Content-Encoding': 'gzip' });
      s.end(zlib.gzipSync(Buffer.from('COMPRESSED')));
    });
    const res = await safeRequest(`http://127.0.0.1:${port}/`, { allowPrivate: true });
    expect(res.body).toBe('COMPRESSED');
  });

  it('refuses the FIRST hop by policy too, without a request going out', async () => {
    let hit = false;
    const port = await listen((_q, s) => { hit = true; s.writeHead(200); s.end('x'); });
    await expect(safeRequest(`http://127.0.0.1:${port}/`, { allowPrivate: false }))
      .rejects.toMatchObject({ status: 403 });
    expect(hit).toBe(false);
  });
});
