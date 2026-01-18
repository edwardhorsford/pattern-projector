import { useCallback, useEffect, useRef } from "react";

// Channel name for Pattern Projector inter-window communication
export const PP_BROADCAST_CHANNEL = "pattern-projector-sync";

// Message types for communication between windows
export type BroadcastMessageType =
  | "state-update" // Control panel -> Main: Update state
  | "state-sync" // Main -> Control panel: Full state sync
  | "request-sync" // Control panel -> Main: Request current state
  | "action" // Control panel -> Main: Trigger an action
  | "file-transfer"; // Control panel -> Main: Transfer a file

export interface BroadcastMessage {
  type: BroadcastMessageType;
  payload: unknown;
  timestamp: number;
}

export interface StateUpdatePayload {
  key: string;
  value: unknown;
}

export interface ActionPayload {
  action: string;
  params?: unknown;
}

export interface FileTransferPayload {
  name: string;
  type: string;
  data: ArrayBuffer;
}

/**
 * Hook for managing BroadcastChannel communication between windows.
 * Used to sync state between the main projector view and control panel.
 */
export function useBroadcastChannel(
  onMessage?: (message: BroadcastMessage) => void,
) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const onMessageRef = useRef(onMessage);

  // Keep the ref up to date with the latest callback
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    // Create channel on mount
    channelRef.current = new BroadcastChannel(PP_BROADCAST_CHANNEL);

    // Set up message handler that uses the ref
    channelRef.current.onmessage = (event: MessageEvent<BroadcastMessage>) => {
      onMessageRef.current?.(event.data);
    };

    // Cleanup on unmount
    return () => {
      channelRef.current?.close();
    };
  }, []); // Empty deps - channel is created once

  /**
   * Send a message to other windows on the same channel
   */
  const postMessage = useCallback(
    (message: Omit<BroadcastMessage, "timestamp">) => {
      channelRef.current?.postMessage({
        ...message,
        timestamp: Date.now(),
      });
    },
    [],
  );

  /**
   * Send a state update to the main window
   */
  const sendStateUpdate = useCallback(
    (key: string, value: unknown) => {
      postMessage({
        type: "state-update",
        payload: { key, value } as StateUpdatePayload,
      });
    },
    [postMessage],
  );

  /**
   * Send a full state sync (from main window to control panel)
   */
  const sendStateSync = useCallback(
    (state: Record<string, unknown>) => {
      postMessage({
        type: "state-sync",
        payload: state,
      });
    },
    [postMessage],
  );

  /**
   * Request the current state from the main window
   */
  const requestSync = useCallback(() => {
    postMessage({
      type: "request-sync",
      payload: null,
    });
  }, [postMessage]);

  /**
   * Send an action to the main window
   */
  const sendAction = useCallback(
    (action: string, params?: unknown) => {
      postMessage({
        type: "action",
        payload: { action, params } as ActionPayload,
      });
    },
    [postMessage],
  );

  /**
   * Send a file to the main window
   */
  const sendFile = useCallback(
    (name: string, type: string, data: ArrayBuffer) => {
      postMessage({
        type: "file-transfer",
        payload: { name, type, data } as FileTransferPayload,
      });
    },
    [postMessage],
  );

  return {
    postMessage,
    sendStateUpdate,
    sendStateSync,
    requestSync,
    sendAction,
    sendFile,
  };
}
