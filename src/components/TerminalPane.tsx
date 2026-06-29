import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Play, Square } from "lucide-react";
import type { Project, SandboxMode, TerminalOutputEvent } from "../types";

interface TerminalPaneProps {
  project: Project | null;
  sandbox: SandboxMode;
  outputs: TerminalOutputEvent[];
  onExec: (command: string, processId: string) => void;
  onWrite: (processId: string, data: string) => void;
  onTerminate: (processId: string) => void;
}

export function TerminalPane({ project, sandbox, outputs, onExec, onWrite, onTerminate }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const outputIndexRef = useRef(0);
  const activeProcessRef = useRef<string | null>(null);
  const [command, setCommand] = useState("pwd");
  const [activeProcess, setActiveProcess] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "JetBrains Mono, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: {
        background: "#101214",
        foreground: "#edf2f1",
        cursor: "#f6c177",
        selectionBackground: "#2f3a3b"
      }
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    fit.fit();
    terminal.writeln("Codex terminal ready.");

    terminal.onData((data) => {
      if (activeProcessRef.current) {
        onWrite(activeProcessRef.current, data);
      }
    });

    terminalRef.current = terminal;
    fitRef.current = fit;

    const resize = () => fit.fit();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [onWrite]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    for (const event of outputs.slice(outputIndexRef.current)) {
      terminal.write(event.text);
    }
    outputIndexRef.current = outputs.length;
  }, [outputs]);

  function runCommand() {
    if (!project || !command.trim()) {
      return;
    }
    const processId = `web-${crypto.randomUUID()}`;
    activeProcessRef.current = processId;
    setActiveProcess(processId);
    terminalRef.current?.writeln(`\r\n$ ${command}`);
    onExec(command, processId);
  }

  function stopCommand() {
    if (!activeProcess) {
      return;
    }
    onTerminate(activeProcess);
    activeProcessRef.current = null;
    setActiveProcess(null);
  }

  return (
    <section className="terminalPane">
      <div className="paneHeader">
        <div>
          <h2>Terminal</h2>
          <p>{project ? project.rootPath : "No project selected"}</p>
        </div>
        <span className={`sandboxBadge ${sandbox === "danger-full-access" ? "danger" : ""}`}>{sandbox}</span>
      </div>
      <div className="commandBar">
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              runCommand();
            }
          }}
          placeholder="shell command"
        />
        <button className="iconButton primary" type="button" onClick={runCommand} disabled={!project} title="Run">
          <Play size={16} />
        </button>
        <button className="iconButton" type="button" onClick={stopCommand} disabled={!activeProcess} title="Stop">
          <Square size={16} />
        </button>
      </div>
      <div ref={containerRef} className="terminalCanvas" />
    </section>
  );
}
