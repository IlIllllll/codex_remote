import { Check, ShieldCheck, X } from "lucide-react";
import type { CodexServerRequest } from "../types";

interface ApprovalPanelProps {
  requests: CodexServerRequest[];
  onRespond: (request: CodexServerRequest, decision: "accept" | "acceptForSession" | "decline" | "cancel") => void;
}

function requestTitle(request: CodexServerRequest): string {
  if (request.method.includes("commandExecution")) {
    return "Command Approval";
  }
  if (request.method.includes("fileChange")) {
    return "File Change Approval";
  }
  if (request.method.includes("requestUserInput")) {
    return "User Input";
  }
  return request.method;
}

export function ApprovalPanel({ requests, onRespond }: ApprovalPanelProps) {
  return (
    <section className="approvalPanel">
      <div className="paneHeader">
        <div>
          <h2>Approvals</h2>
          <p>{requests.length ? `${requests.length} pending` : "Clear"}</p>
        </div>
      </div>
      <div className="approvalList">
        {requests.length === 0 ? (
          <div className="emptyState">No pending approvals.</div>
        ) : (
          requests.map((request) => {
            const params = request.params ?? {};
            const command = typeof params.command === "string" ? params.command : "";
            const cwd = typeof params.cwd === "string" ? params.cwd : "";
            const reason = typeof params.reason === "string" ? params.reason : "";
            return (
              <article className="approvalItem" key={String(request.id)}>
                <div className="approvalTitle">{requestTitle(request)}</div>
                {command ? <pre>{command}</pre> : null}
                {cwd ? <p className="muted">{cwd}</p> : null}
                {reason ? <p>{reason}</p> : null}
                {!command && !reason ? <pre>{JSON.stringify(params, null, 2)}</pre> : null}
                <div className="approvalActions">
                  <button type="button" className="iconTextButton primary" onClick={() => onRespond(request, "accept")}>
                    <Check size={16} />
                    Once
                  </button>
                  <button type="button" className="iconTextButton" onClick={() => onRespond(request, "acceptForSession")}>
                    <ShieldCheck size={16} />
                    Session
                  </button>
                  <button type="button" className="iconTextButton danger" onClick={() => onRespond(request, "decline")}>
                    <X size={16} />
                    Decline
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
