import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRequestDedupeCacheForTests, type PlaylistSource } from "@core";
import { RequestTimeoutError } from "./proxy-fetch.js";
import { validateSource } from "./validate-source.js";

const XTREAM: PlaylistSource = { kind: "xtream", id: "src-1", name: "Provider", baseUrl: "http://tv.example:8080", username: "me", password: "secret" };
const M3U: PlaylistSource = { kind: "m3u-url", id: "src-2", name: "Playlist", url: "http://tv.example/list.m3u" };

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
function authResponse(userInfo: Record<string, unknown>): Response {
  return jsonResponse({ user_info: { auth: 1, status: "Active", exp_date: null, ...userInfo } });
}

describe("validateSource", () => {
  beforeEach(() => __resetRequestDedupeCacheForTests());

  it("accepts a working Xtream login and reports its expiry", async () => {
    const expSeconds = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const fetchImpl = vi.fn().mockResolvedValue(authResponse({ exp_date: String(expSeconds) }));
    const result = await validateSource(XTREAM, { fetchImpl });
    expect(result).toEqual({ ok: true, expiresAt: new Date(expSeconds * 1000) });
  });

  it("rejects a wrong username or password", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(authResponse({ auth: 0 }));
    const result = await validateSource(XTREAM, { fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: "auth", canSaveAnyway: false });
  });

  it("rejects an expired account, whether flagged by status or by date", async () => {
    const byStatus = await validateSource(XTREAM, { fetchImpl: vi.fn().mockResolvedValue(authResponse({ status: "Expired" })) });
    expect(byStatus).toMatchObject({ ok: false, reason: "account", canSaveAnyway: false });

    __resetRequestDedupeCacheForTests();
    const pastSeconds = Math.floor(Date.now() / 1000) - 3600;
    const byDate = await validateSource(XTREAM, { fetchImpl: vi.fn().mockResolvedValue(authResponse({ exp_date: String(pastSeconds) })) });
    expect(byDate).toMatchObject({ ok: false, reason: "account" });
    expect(byDate.ok || byDate.message).toMatch(/expired on/);
  });

  it("treats the panel's HTTP 401 INVALID_AUTH reply as a failed login, with a friendly message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: "INVALID_AUTH", message: "Invalid Authorization or URL / 404 Error.", status: 401 }, 401),
    );
    const result = await validateSource(XTREAM, { fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: "auth", canSaveAnyway: false });
    expect(result.ok || result.message).toMatch(/couldn't sign in/);
    expect(result.ok || result.message).not.toMatch(/HTTP|401/);
  });

  it("rejects banned and disabled accounts even though the login itself worked", async () => {
    const banned = await validateSource(XTREAM, { fetchImpl: vi.fn().mockResolvedValue(authResponse({ status: "Banned" })) });
    expect(banned).toMatchObject({ ok: false, reason: "account", canSaveAnyway: false, message: expect.stringMatching(/banned/) });

    __resetRequestDedupeCacheForTests();
    const disabled = await validateSource(XTREAM, { fetchImpl: vi.fn().mockResolvedValue(authResponse({ status: "Disabled" })) });
    expect(disabled).toMatchObject({ ok: false, reason: "account", canSaveAnyway: false, message: expect.stringMatching(/disabled/) });
  });

  it("an explicit Banned status wins over a still-valid expiry date", async () => {
    const future = String(Math.floor(Date.now() / 1000) + 3600);
    const result = await validateSource(XTREAM, { fetchImpl: vi.fn().mockResolvedValue(authResponse({ status: "Banned", exp_date: future })) });
    expect(result).toMatchObject({ reason: "account", message: expect.stringMatching(/banned/) });
  });

  it("reports when every connection on the account is already in use, but lets the user keep it", async () => {
    const full = await validateSource(XTREAM, {
      fetchImpl: vi.fn().mockResolvedValue(authResponse({ active_cons: "2", max_connections: "2" })),
    });
    expect(full).toMatchObject({ ok: false, reason: "connections", canSaveAnyway: true, message: expect.stringMatching(/All 2 connections/) });

    __resetRequestDedupeCacheForTests();
    const single = await validateSource(XTREAM, { fetchImpl: vi.fn().mockResolvedValue(authResponse({ active_cons: 1, max_connections: 1 })) });
    expect(single).toMatchObject({ reason: "connections", message: expect.stringMatching(/The only connection on this account is in use/) });
  });

  it("accepts the real panel's success payload with free connections, and unlimited (0) max connections", async () => {
    const realPayload = {
      user_info: {
        username: "",
        password: "",
        message: "API Message",
        auth: 1,
        status: "Active",
        exp_date: "1820993863",
        is_trial: "0",
        active_cons: "0",
        created_at: "1789425198",
        max_connections: "2",
        allowed_output_formats: ["m3u8", "ts", "rtmp"],
      },
      server_info: { url: "premiumbrp.store", port: "80", https_port: "443", server_protocol: "http", timestamp_now: 1790324565 },
    };
    const result = await validateSource(XTREAM, { fetchImpl: vi.fn().mockResolvedValue(jsonResponse(realPayload)) });
    expect(result).toEqual({ ok: true, expiresAt: new Date(1820993863 * 1000) });

    __resetRequestDedupeCacheForTests();
    const unlimited = await validateSource(XTREAM, { fetchImpl: vi.fn().mockResolvedValue(authResponse({ active_cons: "5", max_connections: "0" })) });
    expect(unlimited.ok).toBe(true);
  });

  it("offers Save anyway only for failures that may be the provider's fault", async () => {
    const notFound = await validateSource(XTREAM, { fetchImpl: vi.fn().mockResolvedValue(jsonResponse({}, 404)) });
    expect(notFound).toMatchObject({ ok: false, reason: "http", canSaveAnyway: false });

    const serverError = await validateSource(XTREAM, { fetchImpl: vi.fn().mockResolvedValue(jsonResponse({}, 503)) });
    expect(serverError).toMatchObject({ ok: false, reason: "http", canSaveAnyway: true });

    const unreachable = await validateSource(XTREAM, { fetchImpl: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) });
    expect(unreachable).toMatchObject({ ok: false, reason: "unreachable", canSaveAnyway: true });

    const timedOut = await validateSource(XTREAM, { fetchImpl: vi.fn().mockRejectedValue(new RequestTimeoutError(15_000)) });
    expect(timedOut).toMatchObject({ ok: false, reason: "timeout", canSaveAnyway: true });
  });

  it("flags a server that answers with something other than Xtream JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => JSON.parse("<html>") } as Response);
    const result = await validateSource(XTREAM, { fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: "http", message: expect.stringMatching(/Xtream Codes server/) });
  });

  it("accepts an M3U URL whose body starts with #EXTM3U, reading only its head", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('﻿#EXTM3U\n#EXTINF:-1,News\nhttp://tv.example/1.ts\n'));
    await expect(validateSource(M3U, { fetchImpl })).resolves.toEqual({ ok: true, expiresAt: null });
  });

  it("rejects an M3U URL that serves something else", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<!doctype html><title>Login</title>"));
    const result = await validateSource(M3U, { fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: "not-a-playlist", canSaveAnyway: false });
  });

  it("passes the caller's signal through and rejects when aborted", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      controller.abort();
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    await expect(validateSource(XTREAM, { fetchImpl: fetchImpl as unknown as typeof fetch, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
