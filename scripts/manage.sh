#!/bin/bash
# Neotree OpenCR Bridge - Management Script
# Usage: ./scripts/manage.sh [start|stop|restart|status]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="/tmp/bridge.log"

cd "$PROJECT_DIR"

case "${1:-}" in
  start)
    echo "🚀 Starting Neotree OpenCR Bridge..."
    
    # Check if already running
    if pgrep -f "node dist/index.js" > /dev/null; then
      echo "⚠️  Bridge is already running!"
      exit 1
    fi
    
    # Start the bridge
    npm start > "$LOG_FILE" 2>&1 &
    sleep 3
    
    # Check if started successfully
    if pgrep -f "node dist/index.js" > /dev/null; then
      echo "✅ Bridge started successfully!"
      echo "📍 Logs: $LOG_FILE"
      echo "🌐 Health: http://localhost:${PORT:-3001}/health"
      tail -5 "$LOG_FILE"
    else
      echo "❌ Failed to start bridge. Check logs: $LOG_FILE"
      exit 1
    fi
    ;;
    
  stop)
    echo "🛑 Stopping Neotree OpenCR Bridge..."
    
    if ! pgrep -f "node dist/index.js" > /dev/null; then
      echo "⚠️  Bridge is not running!"
      exit 0
    fi
    
    pkill -f "node dist/index.js"
    sleep 2
    
    if pgrep -f "node dist/index.js" > /dev/null; then
      echo "❌ Failed to stop bridge. Force killing..."
      pkill -9 -f "node dist/index.js"
      sleep 1
    fi
    
    echo "✅ Bridge stopped successfully!"
    ;;
    
  restart)
    echo "🔄 Restarting Neotree OpenCR Bridge..."
    "$0" stop
    sleep 2
    "$0" start
    ;;
    
  status)
    echo "📊 Neotree OpenCR Bridge Status"
    echo "================================"
    
    if pgrep -f "node dist/index.js" > /dev/null; then
      echo "✅ Status: RUNNING"
      PID=$(pgrep -f "node dist/index.js" | head -1)
      echo "📍 PID: $PID"
      
      # Check health endpoint
      PORT=$(grep "^PORT=" .env 2>/dev/null | cut -d'=' -f2 || echo "3001")
      if curl -s "http://localhost:${PORT}/health" > /dev/null 2>&1; then
        echo "✅ Health: OK"
      else
        echo "⚠️  Health: Not responding"
      fi
      
      echo ""
      echo "📋 Recent logs (last 10 lines):"
      tail -10 "$LOG_FILE" 2>/dev/null || echo "No logs found"
    else
      echo "❌ Status: STOPPED"
    fi
    ;;
    
  logs)
    echo "📋 Following logs (Ctrl+C to exit)..."
    tail -f "$LOG_FILE" 2>/dev/null || echo "No log file found: $LOG_FILE"
    ;;
    
  *)
    echo "Neotree OpenCR Bridge - Management Script"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  start    - Start the bridge"
    echo "  stop     - Stop the bridge"
    echo "  restart  - Restart the bridge"
    echo "  status   - Check bridge status"
    echo "  logs     - Follow logs"
    echo ""
    echo "Examples:"
    echo "  $0 start      # Start the bridge"
    echo "  $0 stop       # Stop the bridge"
    echo "  $0 restart    # Restart the bridge"
    echo "  $0 status     # Check if running"
    echo "  $0 logs       # View live logs"
    exit 1
    ;;
esac

