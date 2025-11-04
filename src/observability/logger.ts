import pino from "pino";
import { createWriteStream } from "fs";

const logLevel = process.env.LOG_LEVEL || "info";
const logFile = process.env.LOG_FILE;

// Create streams array for multi-stream logging
const streams: Array<{ stream: NodeJS.WritableStream }> = [
  { stream: process.stdout } // Always write to stdout
];

// Optionally add file stream if LOG_FILE is set
if (logFile) {
  streams.push({
    stream: createWriteStream(logFile, { flags: "a" }) // Append mode
  });
}

// Create logger with single or multi-stream destination
const destination = streams.length > 1 
  ? pino.multistream(streams) 
  : streams[0]!.stream;

export const logger = pino(
  {
    level: logLevel
  },
  destination
);

