"""Static file server for the Playwright suites.

Serves the current directory like `python3 -m http.server`, with a listen backlog sized for
parallel workers. The stock backlog of 5 overflows when several pages boot at once, and macOS
answers an overflowed backlog with a connection reset, so app scripts fail to load.
"""

import functools
import http.server
import sys


class StaticServer(http.server.ThreadingHTTPServer):
    """Threading server whose listen backlog absorbs a parallel boot burst."""

    request_queue_size = 256
    daemon_threads = True


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """Serves files without a log line per request."""

    def log_message(self, format, *args):  # noqa: A002 - signature set by the base class
        pass


def main():
    """Serve the current directory on the port given as the first argument."""
    port = int(sys.argv[1])
    handler = functools.partial(QuietHandler, directory=".")
    with StaticServer(("", port), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
