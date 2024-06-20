/* eslint-disable @typescript-eslint/no-explicit-any */
const logMessages: string[] = [];

const originalLog = console.log;
const originalError = console.error;

console.log = (...args: any[]) => {
    const message = args.join(' ');
    logMessages.push(message);
    originalLog(...args);
};

console.error = (...args: any[]) => {
    const message = args.join(' ');
    logMessages.push(message);
    originalError(...args); 
};

export function getLogMessages() {
    return logMessages;
}

export function clearLogMessages() {
    logMessages.length = 0;
}