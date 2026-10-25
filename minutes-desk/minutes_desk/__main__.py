"""python -m minutes_desk            start the desk app on http://127.0.0.1:4330
python -m minutes_desk doctor     check what this computer can run
python -m minutes_desk transcribe <file> [-o out.json]   command-line transcription
"""

import argparse
import json
import sys
import webbrowser

from . import config, engines, governance, server


def main(argv=None):
    ap = argparse.ArgumentParser(prog="minutes_desk")
    sub = ap.add_subparsers(dest="cmd")
    run = sub.add_parser("serve")
    run.add_argument("--port", type=int)
    run.add_argument("--no-browser", action="store_true")
    sub.add_parser("doctor")
    tr = sub.add_parser("transcribe")
    tr.add_argument("media")
    tr.add_argument("-o", "--out")
    tr.add_argument("--model", default="")
    tr.add_argument("--engine", default="")
    tr.add_argument("--speed", type=float, default=1.0, help="playback speed the file was saved at, e.g. 1.5 or 2")
    tr.add_argument("--pace", type=float, default=1.0, help="feed speech to the model slower, e.g. 0.8")
    tr.add_argument("--language", default="", help="ar, en or auto (detect per chunk, for mixed Arabic/English)")
    args = ap.parse_args(argv)

    if args.cmd == "doctor":
        report = engines.doctor()
        for c in report["checks"]:
            print(("OK   " if c["ok"] else "--   ") + c["name"] + ("" if c["ok"] else "   → " + c["fix"]))
        print(f"device: {report['device']}  engines: {', '.join(report['engines']) or 'none'}")
        return 0
    if args.cmd == "transcribe":
        cfg = config.load()
        result = engines.transcribe(args.media, cfg, args.engine, args.model,
                                    lambda pct, msg: print(f"[{pct:3d}%] {msg}", file=sys.stderr), args.speed, args.pace, args.language)
        result["segments"] = governance.flag_transcript(result["segments"])
        text = json.dumps(result, ensure_ascii=False, indent=1)
        if args.out:
            open(args.out, "w", encoding="utf-8").write(text)
        else:
            print(text)
        return 0

    httpd = server.serve(port=getattr(args, "port", None))
    url = f"http://127.0.0.1:{httpd.server_address[1]}"
    print(f"Minutes Desk on {url}  (workspace: {config.WORKSPACE})  Ctrl+C to stop")
    if not getattr(args, "no_browser", False):
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
