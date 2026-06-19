"""
Teams Transcript Viewer - Main Application
Simple orchestrator that runs API and caption capture together or separately.
"""

import argparse
import os
import threading
import time
import tracemalloc

# Import the main functions from each module
from api import run_api
from capture_captions import main as run_caption_capture


def main():
    parser = argparse.ArgumentParser(description='Teams Transcript Viewer')
    parser.add_argument('--api-only', action='store_true', help='Run only the API server')
    parser.add_argument('--capture-only', action='store_true', help='Run only caption capture')
    parser.add_argument('--port', type=int, default=5000, help='API server port (default: 5000)')
    parser.add_argument('--debug', action='store_true', help='Enable Flask debug mode')
    
    args = parser.parse_args()
    
    # Start tracemalloc for memory profiling
    tracemalloc.start()
    print("[MAIN] tracemalloc memory tracing enabled")

    # Validate arguments
    if args.api_only and args.capture_only:
        print("Error: Cannot use both --api-only and --capture-only")
        return
    
    # Determine what to run
    run_api_server = not args.capture_only
    run_capture = not args.api_only
    
    # When Flask debug mode is on, the reloader will restart the process
    # Only start capture in the reloader subprocess, not the main process
    is_reloader_subprocess = os.environ.get('WERKZEUG_RUN_MAIN') == 'true'
    should_start_capture = run_capture and (not args.debug or is_reloader_subprocess)
    
    # Only print header in main process or when not using API
    if not args.debug or is_reloader_subprocess or not run_api_server:
        print("=" * 60)
        print("Teams Transcript Viewer")
        print("=" * 60)
    
    if run_capture and run_api_server:
        # Run both in parallel - capture in background thread, API in main thread
        if should_start_capture:
            print("[MAIN] Starting caption capture in background thread...")
            capture_thread = threading.Thread(target=run_caption_capture, daemon=True)
            capture_thread.start()
            time.sleep(1)  # Give capture a moment to start
        
        if not args.debug or is_reloader_subprocess:
            print("[MAIN] Starting API server...")
        run_api(port=args.port, debug=args.debug)
        
    elif run_capture:
        # Only capture
        print("[MAIN] Running caption capture only...")
        run_caption_capture()
        
    elif run_api_server:
        # Only API
        print("[MAIN] Running API server only...")
        run_api(port=args.port, debug=args.debug)


if __name__ == '__main__':
    main()
