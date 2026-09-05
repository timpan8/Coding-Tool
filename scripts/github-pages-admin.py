"""Maintainer-only GitHub Pages setup/status using the configured Git credential helper.

Credentials are kept in memory and are never written or printed. Not part of the app build.
"""
import json
import subprocess
import sys
import urllib.request
import urllib.error

REPOSITORY = "timpan8/Coding-Tool"


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "status"
    if mode not in ("status", "configure"):
        raise ValueError("Use status or configure")
    credential = subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\npath=" + REPOSITORY + ".git\n\n", text=True, capture_output=True, check=True)
    fields = dict(line.split("=", 1) for line in credential.stdout.splitlines() if "=" in line)
    token = fields.get("password")
    if not token:
        raise ValueError("No configured Git credential")

    def request(path="", method="GET", payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request("https://api.github.com/repos/" + REPOSITORY + "/pages" + path, data=data, method=method,
            headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "AI-Code-Vault-maintainer"})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                body = response.read()
                return response.status, json.loads(body) if body else {}
        except urllib.error.HTTPError as exc:
            # Output only status and the public API message, never headers or credentials.
            return exc.code, {"message": json.loads(exc.read()).get("message", "GitHub request failed")}

    status, info = request()
    if mode == "configure":
        if status == 404:
            status, info = request(method="POST", payload={"source": {"branch": "gh-pages", "path": "/"}, "build_type": "legacy"})
        elif status == 200 and info.get("source") != {"branch": "gh-pages", "path": "/"}:
            status, info = request(method="PUT", payload={"source": {"branch": "gh-pages", "path": "/"}, "build_type": "legacy"})
        if status in (200, 201, 204):
            status, info = request()
    print(json.dumps({"http_status": status, **{key: info[key] for key in ("status", "html_url", "source", "message") if key in info}}))
    if status == 200:
        build_status, build = request("/builds/latest")
        print(json.dumps({"build_http_status": build_status, **{key: build[key] for key in ("status", "commit", "error") if key in build}}))
    if status >= 400:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("GitHub Pages operation failed; no credential details were logged.")
        sys.exit(1)
