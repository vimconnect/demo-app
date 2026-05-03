"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { initVimSDK, type VimSDK, type AppManifest, type WorkflowEvent, type AppOpenStatus, type ContextKey, type ContextKeyEntityMap, type EventType } from '@vimconnect/app-sdk";

type LogEntry = {
  timestamp: string;
  message: string;
  type: "info" | "success" | "error";
};

type UpdaterInfo = {
  entityType: string;
  fieldPath: string;
  componentId: string;
  value: string;
  mode: "override" | "append";
};

type EventPreview = {
  id: string;
  timestamp: string;
  type: string;
  data: Record<string, unknown>;
  streamType: "workflow" | "context";
};

type ContextEntityData = ContextKeyEntityMap[ContextKey];

type ContextChange = {
  contextKey: string;
  timestamp: string;
  changeType: "opened" | "changed" | "closed";
  previousData: ContextEntityData | undefined;
  currentData: ContextEntityData | undefined;
};

type AppStateLogEntry = {
  timestamp: string;
  isOpen: boolean;
  trigger?: string;
};

/**
 * Main App Page Content - OAuth Callback + Full SDK Demo
 */
function AppPageContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "connected" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [vimSDK, setVimSDK] = useState<VimSDK | null>(null);
  const [manifest, setManifest] = useState<AppManifest | null>(null);

  // Activity Log
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);

  // Event subscriptions
  const [subscribedWorkflowEvents, setSubscribedWorkflowEvents] = useState<
    Set<string>
  >(new Set());
  const [subscribedContexts, setSubscribedContexts] = useState<Set<string>>(
    new Set(),
  );
  const contextUnsubscribeRefs = useRef<Map<string, () => void>>(new Map());
  const [eventPreviews, setEventPreviews] = useState<EventPreview[]>([]);
  const [contextChanges, setContextChanges] = useState<ContextChange[]>([]);

  // Updaters (Write to EHR)
  const [activeUpdaters, setActiveUpdaters] = useState<
    Map<string, Map<string, UpdaterInfo>>
  >(new Map());
  const [detectedComponents, setDetectedComponents] = useState<
    Map<string, Set<string>>
  >(new Map());

  // Collapsible sections state
  const [sdkSubscriptionCollapsed, setSdkSubscriptionCollapsed] =
    useState(true);
  const [hubControlsCollapsed, setHubControlsCollapsed] = useState(true);
  const [eventPreviewCollapsed, setEventPreviewCollapsed] = useState(true);
  const [activeUpdatersCollapsed, setActiveUpdatersCollapsed] = useState(true);
  const [activityLogCollapsed, setActivityLogCollapsed] = useState(false); // Open by default

  // Modal state
  const [manifestModalOpen, setManifestModalOpen] = useState(false);

  // Hub Controls state
  const [hubActivationStatus, setHubActivationStatus] = useState<
    "ENABLED" | "LOADING" | "DISABLED"
  >("ENABLED");
  const [tooltipText, setTooltipText] = useState("");
  const [notificationBadgeActive, setNotificationBadgeActive] = useState(false);
  const [notificationBadgeCount, setNotificationBadgeCount] = useState(3);
  const [microphoneBadgeActive, setMicrophoneBadgeActive] = useState(false);
  const [pushNotificationText, setPushNotificationText] = useState(
    "Important update available",
  );
  const [pushNotificationTimeout, setPushNotificationTimeout] = useState(12);
  const [appStateSubscribed, setAppStateSubscribed] = useState(false);
  const [appStateIsOpen, setAppStateIsOpen] = useState<boolean | null>(null);
  const [appStateLog, setAppStateLog] = useState<AppStateLogEntry[]>([]);

  const appStateUnsubRef = useRef<(() => void) | null>(null);

  // Prevent duplicate initialization
  const initializingRef = useRef(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current || initializingRef.current) {
      return;
    }
    initializingRef.current = true;
    initializeApp();
  }, []);

  function addLog(
    message: string,
    type: "info" | "success" | "error" = "info",
  ) {
    setLogEntries((prev) => [
      {
        timestamp: new Date().toLocaleTimeString(),
        message,
        type,
      },
      ...prev,
    ]);
  }

  async function initializeApp() {
    try {
      const code = searchParams.get("code");
      const stateParam = searchParams.get("state");

      if (!code || !stateParam) {
        throw new Error("Missing OAuth parameters");
      }

      // Validate CSRF state
      const [launchId, csrfToken] = stateParam.split(":");
      if (!launchId || !csrfToken) {
        throw new Error("Invalid state parameter format");
      }

      const flowKey = `oauth_state_${launchId}`;
      const storedToken = sessionStorage.getItem(flowKey);

      if (csrfToken !== storedToken) {
        throw new Error("CSRF validation failed");
      }

      sessionStorage.removeItem(flowKey);

      initializedRef.current = true;

      // Initialize SDK via npm import (typed)
      const sdk = await initVimSDK({
        debug: true,
      });

      setVimSDK(sdk);
      setStatus("connected");
      addLog("SDK initialized successfully", "success");

      // Load manifest
      const sdkManifest = sdk.ehr.getManifest();
      setManifest(sdkManifest);

      addLog(
        `Manifest loaded: ${sdkManifest.supportedEvents?.length || 0} events, ${sdkManifest.supportedContexts?.length || 0} contexts`,
        "info",
      );
    } catch (err: any) {
      console.error("Initialization error:", err);
      setError(err.message);
      setStatus("error");
      initializedRef.current = false;
    } finally {
      initializingRef.current = false;
    }
  }

  // Hub Control Functions
  function hubSetActivationStatus(
    newStatus: "ENABLED" | "LOADING" | "DISABLED",
  ) {
    if (!vimSDK) return;
    vimSDK.hub.setActivationStatus(newStatus);
    setHubActivationStatus(newStatus);
    addLog(`Hub: setActivationStatus → ${newStatus}`, "success");
  }

  function hubApplyTooltip() {
    if (!vimSDK || !tooltipText.trim()) return;
    vimSDK.hub.setTooltipText(tooltipText);
    addLog(`Hub: setTooltipText → "${tooltipText}"`, "success");
  }

  function hubClearTooltip() {
    if (!vimSDK) return;
    vimSDK.hub.setTooltipText("");
    setTooltipText("");
    addLog("Hub: tooltip cleared", "success");
  }

  function hubToggleNotificationBadge() {
    if (!vimSDK) return;
    const newState = !notificationBadgeActive;
    if (newState) {
      vimSDK.hub.notificationBadge.set(notificationBadgeCount);
      addLog(
        `Hub: notificationBadge.set(${notificationBadgeCount})`,
        "success",
      );
    } else {
      vimSDK.hub.notificationBadge.hide();
      addLog("Hub: notificationBadge.hide()", "info");
    }
    setNotificationBadgeActive(newState);
  }

  function hubToggleMicrophoneBadge() {
    if (!vimSDK) return;
    const newState = !microphoneBadgeActive;
    if (newState) {
      vimSDK.hub.microphoneBadge.show();
      addLog("Hub: microphoneBadge.show()", "success");
    } else {
      vimSDK.hub.microphoneBadge.hide();
      addLog("Hub: microphoneBadge.hide()", "info");
    }
    setMicrophoneBadgeActive(newState);
  }

  function hubShowPushNotification() {
    if (!vimSDK) return;
    const details = {
      text: pushNotificationText,
      notificationId: `demo-${Date.now()}`,
      timeoutInSec: pushNotificationTimeout,
    };
    vimSDK.hub.pushNotification.show(details);
    addLog(
      `Hub: pushNotification.show (timeout: ${pushNotificationTimeout}s)`,
      "success",
    );
  }

  function hubHidePushNotification() {
    if (!vimSDK) return;
    vimSDK.hub.pushNotification.hide();
    addLog("Hub: pushNotification.hide()", "success");
  }

  // Multi-notification test presets
  type NotifPreset = {
    label: string;
    title?: string;
    text: string;
    type?: "warning" | "success" | "critical";
    imageUrl?: string;
    buttons?: {
      leftButton?: {
        text: string;
        buttonStyle: "PRIMARY" | "LINK";
        callback: () => void;
        openAppButton?: boolean;
      };
      rightButton?: {
        text: string;
        buttonStyle: "PRIMARY" | "LINK";
        callback: () => void;
        openAppButton?: boolean;
      };
    };
  };

  const MULTI_NOTIF_PRESETS: NotifPreset[] = [
    {
      label: "🔴 Critical (no timeout, ack required)",
      title: "Drug Interaction Detected",
      text: "<b>Warfarin</b> + <b>Aspirin</b> — high bleed risk. Review immediately.",
      type: "critical" as const,
      buttons: {
        rightButton: {
          text: "Review",
          buttonStyle: "PRIMARY" as const,
          openAppButton: true,
          callback: () => {},
        },
      },
    },
    {
      label: "⚠️ Warning",
      title: "Prior Auth Expiring",
      text: "Prior auth expires in <b>3 days</b>",
      type: "warning" as const,
      buttons: {
        leftButton: {
          text: "Dismiss",
          buttonStyle: "LINK" as const,
          callback: () => {},
        },
        rightButton: {
          text: "Renew",
          buttonStyle: "PRIMARY" as const,
          openAppButton: true,
          callback: () => {},
        },
      },
    },
    {
      label: "✅ Success",
      title: "Care Gap Closed",
      text: "HbA1c documented — gap resolved ✓",
      type: "success" as const,
    },
    {
      label: "🔴 Critical plain",
      title: "Critical Lab Value",
      text: "Hemoglobin 5.2 g/dL — critical low",
      type: "critical" as const,
    },
    {
      label: "Plain (no type)",
      text: "Patient A1C is 9.2 — review recommended",
    },
    {
      label: "⚠️ Warning multi-line",
      title: "Medication Alert",
      text: "<b>Warfarin 5mg</b> — INR check overdue",
      type: "warning" as const,
    },
  ];

  function hubFirePreset(index: number) {
    if (!vimSDK) return;
    const preset = MULTI_NOTIF_PRESETS[index];
    const notificationId = `demo-preset-${index}-${Date.now()}`;
    vimSDK.hub.pushNotification.show({
      title: preset.title,
      text: preset.text,
      notificationId,
      timeoutInSec: 30,
      type: preset.type,
      imageUrl: preset.imageUrl,
      actionButtons: preset.buttons,
    });
    addLog(`Push: fired preset "${preset.label}"`, "success");
  }

  function hubFireCount(count: number) {
    if (!vimSDK) return;
    const ts = Date.now();
    for (let i = 0; i < count; i++) {
      const preset = MULTI_NOTIF_PRESETS[i % MULTI_NOTIF_PRESETS.length];
      vimSDK.hub.pushNotification.show({
        title: preset.title,
        text: preset.text,
        notificationId: `demo-burst-${i}-${ts}`,
        timeoutInSec: 30,
        type: preset.type,
        imageUrl: preset.imageUrl,
        actionButtons: preset.buttons,
      });
    }
    addLog(`Push: fired ${count} notifications`, "success");
  }

  function hubCloseApp() {
    if (!vimSDK) return;
    vimSDK.hub.closeApp();
    addLog("Hub: closeApp()", "success");
  }

  function hubSubscribeAppState() {
    if (!vimSDK || appStateSubscribed) return;

    appStateUnsubRef.current = vimSDK.hub.appState.subscribe(
      "appOpenStatus",
      (statusEvent: AppOpenStatus) => {
        setAppStateIsOpen(statusEvent.isAppOpen);
        setAppStateLog((prev) => [
          {
            timestamp: new Date().toLocaleTimeString(),
            isOpen: statusEvent.isAppOpen,
            trigger: statusEvent.isAppOpen
              ? statusEvent.appOpenTrigger
              : statusEvent.appCloseTrigger,
          },
          ...prev,
        ]);
        addLog(
          `Hub: appState changed → isAppOpen=${statusEvent.isAppOpen}`,
          statusEvent.isAppOpen ? "success" : "info",
        );
      },
    );

    setAppStateSubscribed(true);
    addLog("Hub: subscribed to appState", "success");
  }

  function hubUnsubscribeAppState() {
    if (appStateUnsubRef.current) {
      appStateUnsubRef.current();
      appStateUnsubRef.current = null;
    }
    setAppStateSubscribed(false);
    setAppStateLog([]);
    addLog("Hub: unsubscribed from appState", "info");
  }

  // Event Subscription Functions
  function toggleWorkflowEvent(eventId: string) {
    if (!vimSDK) return;

    const newSet = new Set(subscribedWorkflowEvents);
    if (newSet.has(eventId)) {
      newSet.delete(eventId);
      addLog(`Unsubscribed from ${eventId}`, "info");
    } else {
      newSet.add(eventId);
      vimSDK.ehr.workflow.on(eventId as EventType, (event: WorkflowEvent) => {
        addLog(`Workflow event: ${event.type}`, "success");
        setEventPreviews((prev) => [
          {
            id: eventId,
            timestamp: new Date().toISOString(),
            type: event.type,
            data: event as unknown as Record<string, unknown>,
            streamType: "workflow",
          },
          ...prev,
        ]);

        // Mark component as detected
        const componentId = event.metadata?.componentId;
        if (componentId) {
          setDetectedComponents((prev) => {
            const newMap = new Map(prev);
            if (!newMap.has(eventId)) {
              newMap.set(eventId, new Set());
            }
            newMap.get(eventId)!.add(componentId);
            return newMap;
          });
          addLog(
            `Component detected: ${componentId} for ${eventId}`,
            "success",
          );
        }
      });
      addLog(`Subscribed to ${eventId}`, "success");
    }
    setSubscribedWorkflowEvents(newSet);
  }

  function toggleContextEvent(contextKey: string) {
    if (!vimSDK) return;

    // Validate context key
    if (
      !contextKey ||
      contextKey === "undefined" ||
      contextKey.startsWith("context-")
    ) {
      addLog(`Invalid context key: ${contextKey}`, "error");
      console.error("Invalid context key:", contextKey);
      return;
    }

    const newSet = new Set(subscribedContexts);
    if (newSet.has(contextKey)) {
      newSet.delete(contextKey);
      contextUnsubscribeRefs.current.get(contextKey)?.();
      contextUnsubscribeRefs.current.delete(contextKey);
      addLog(`Unsubscribed from context ${contextKey}`, "info");
    } else {
      newSet.add(contextKey);
      try {
        const unsubscribe = vimSDK.ehr.context.onChange(
          contextKey as ContextKey,
          (previousData, currentData) => {
            const changeType =
              !previousData && currentData
                ? "opened"
                : previousData && currentData
                  ? "changed"
                  : "closed";
            addLog(`Context ${changeType}: ${contextKey}`, "success");
            setContextChanges((prev) => [
              {
                contextKey,
                timestamp: new Date().toISOString(),
                changeType,
                previousData,
                currentData,
              },
              ...prev,
            ]);
          },
        );
        contextUnsubscribeRefs.current.set(contextKey, unsubscribe);
        addLog(`Subscribed to context ${contextKey}`, "success");
      } catch (err: any) {
        addLog(`Failed to subscribe to context: ${err.message}`, "error");
        newSet.delete(contextKey);
      }
    }
    setSubscribedContexts(newSet);
  }

  // Updater Functions (Write to EHR)
  function toggleUpdater(
    entityTypeKey: string,
    fieldPath: string,
    componentId: string,
  ) {
    const key = `${entityTypeKey}:${fieldPath}`;
    const newMap = new Map(activeUpdaters);

    if (newMap.has(entityTypeKey) && newMap.get(entityTypeKey)!.has(key)) {
      newMap.get(entityTypeKey)!.delete(key);
      if (newMap.get(entityTypeKey)!.size === 0) {
        newMap.delete(entityTypeKey);
      }
      addLog(`Disabled updater for ${fieldPath}`, "info");
    } else {
      if (!newMap.has(entityTypeKey)) {
        newMap.set(entityTypeKey, new Map());
      }
      newMap.get(entityTypeKey)!.set(key, {
        entityType: entityTypeKey,
        fieldPath,
        componentId,
        value: "",
        mode: "override",
      });
      addLog(`Enabled updater for ${fieldPath}`, "success");
    }

    setActiveUpdaters(newMap);
  }

  async function executeUpdate(updaterInfo: UpdaterInfo) {
    if (!vimSDK) return;

    try {
      addLog(
        `Executing update: ${updaterInfo.entityType}.${updaterInfo.fieldPath} = "${updaterInfo.value}"  (${updaterInfo.mode})`,
        "info",
      );

      const namespace = (vimSDK.ehr.context as any)[updaterInfo.entityType];
      if (!namespace) {
        addLog(`No writeback namespace for ${updaterInfo.entityType}`, "error");
        return;
      }

      // Request permission if needed before updating
      if (!namespace.hasPermission("update")) {
        addLog(
          `Requesting permission for ${updaterInfo.entityType}...`,
          "info",
        );
        const permResult = await namespace.requestPermission("update");
        if (permResult !== "granted") {
          addLog(`Permission denied for ${updaterInfo.entityType}`, "error");
          return;
        }
      }

      let parsedValue: any = updaterInfo.value;
      try {
        parsedValue = JSON.parse(updaterInfo.value);
      } catch {
        // Not valid JSON — send as plain string
      }

      const result = await namespace.update(
        { [updaterInfo.fieldPath]: parsedValue },
        { mode: updaterInfo.mode },
      );

      if (result && result.success === false) {
        addLog(`Update failed: ${result.error || "Unknown error"}`, "error");
        return;
      }

      addLog(
        `Update successful: ${updaterInfo.entityType}.${updaterInfo.fieldPath}`,
        "success",
      );
    } catch (err: any) {
      addLog(`Update failed: ${err.message}`, "error");
    }
  }

  function updateUpdaterValue(
    entityTypeKey: string,
    key: string,
    value: string,
  ) {
    setActiveUpdaters((prev) => {
      const newMap = new Map(prev);
      if (newMap.has(entityTypeKey) && newMap.get(entityTypeKey)!.has(key)) {
        const updater = newMap.get(entityTypeKey)!.get(key)!;
        newMap.get(entityTypeKey)!.set(key, { ...updater, value });
      }
      return newMap;
    });
  }

  function updateUpdaterMode(
    entityTypeKey: string,
    key: string,
    mode: "override" | "append",
  ) {
    setActiveUpdaters((prev) => {
      const newMap = new Map(prev);
      if (newMap.has(entityTypeKey) && newMap.get(entityTypeKey)!.has(key)) {
        const updater = newMap.get(entityTypeKey)!.get(key)!;
        newMap.get(entityTypeKey)!.set(key, { ...updater, mode });
      }
      return newMap;
    });
  }

  if (status === "loading") {
    return (
      <div className="loading-container">
        <div className="loading-content">
          <div className="spinner" style={{ margin: "0 auto 16px" }} />
          <p style={{ color: "var(--color-text-muted)" }}>
            Connecting to Vim...
          </p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="error-container">
        <div className="error-content">
          <h2>Connection Error</h2>
          <p>{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="btn btn-danger"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const supportedEvents = manifest?.supportedEvents || [];
  const supportedContexts = manifest?.supportedContexts || [];
  const contextWriteback: Record<string, any> =
    manifest?.contextWriteback || {};
  // Flatten contextWriteback into a list for the UI
  const writebackEntries = Object.entries(contextWriteback).flatMap(
    ([entityType, config]: [string, any]) =>
      (config.update?.updatableFields ?? []).map((field: string) => ({
        entityType,
        fieldPath: field,
        disruptive: config.update?.disruptive ?? false,
      })),
  );

  return (
    <div className="demo-container">
      {/* Header */}
      <div className="demo-header">
        <h1>Vim Connect Demo App</h1>
        <p className="demo-header-subtitle">
          Connected via OAuth • SDK Version: {manifest?.version || "Unknown"}
        </p>
        <div className="status-badge">
          <div className="status-dot" />
          <span>Connected</span>
        </div>
      </div>

      <div className="demo-content">
        {/* View SDK Manifest Button */}
        <div style={{ marginBottom: "var(--space-2xl)" }}>
          <button
            onClick={() => setManifestModalOpen(true)}
            className="btn-gradient"
          >
            View SDK Manifest
          </button>
        </div>

        {/* SDK Subscriptions */}
        <div className="section-collapsible">
          <div
            className="section-header"
            onClick={() =>
              setSdkSubscriptionCollapsed(!sdkSubscriptionCollapsed)
            }
          >
            <div
              className="section-chevron"
              style={{
                transform: sdkSubscriptionCollapsed
                  ? "rotate(0deg)"
                  : "rotate(90deg)",
              }}
            >
              ▶
            </div>
            <h2 className="section-title">SDK Subscriptions</h2>
          </div>
          <div
            className={`section-content ${sdkSubscriptionCollapsed ? "collapsed" : ""}`}
          >
            <div className="section-inner">
              <div className="demo-card-section">
                <div className="demo-card-label">
                  Workflow Events ({supportedEvents.length})
                </div>
                <div className="event-list">
                  {supportedEvents.length === 0 ? (
                    <div className="empty-state">
                      No workflow events available
                    </div>
                  ) : (
                    supportedEvents.map((evt: { id: string; name?: string }, idx: number) => (
                      <div key={evt.id || `evt-${idx}`} className="event-item">
                        <div className="event-name">{evt.name || evt.id}</div>
                        <div
                          className="toggle-switch"
                          onClick={() => toggleWorkflowEvent(evt.id)}
                        >
                          <div
                            className={`toggle-track ${subscribedWorkflowEvents.has(evt.id) ? "active" : ""}`}
                          >
                            <div className="toggle-thumb" />
                          </div>
                          <span className="toggle-label">
                            {subscribedWorkflowEvents.has(evt.id)
                              ? "ON"
                              : "OFF"}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="demo-card-section">
                <div className="demo-card-label">
                  Context Events ({supportedContexts.length})
                </div>
                <div className="event-list">
                  {supportedContexts.length === 0 ? (
                    <div className="empty-state">
                      No context events available
                    </div>
                  ) : (
                    supportedContexts.map((ctx: { key?: string; contextKey?: string; name?: string; workflowEventId?: string; entityType?: string }, idx: number) => {
                      const contextKey =
                        ctx.key ||
                        ctx.contextKey ||
                        (ctx.workflowEventId && ctx.entityType
                          ? `${ctx.workflowEventId}:${ctx.entityType}`
                          : `context-${idx}`);
                      const displayName = ctx.name || contextKey;

                      return (
                        <div key={contextKey} className="event-item">
                          <div className="event-name">{displayName}</div>
                          <div
                            className="toggle-switch"
                            onClick={() => toggleContextEvent(contextKey)}
                          >
                            <div
                              className={`toggle-track ${subscribedContexts.has(contextKey) ? "active" : ""}`}
                            >
                              <div className="toggle-thumb" />
                            </div>
                            <span className="toggle-label">
                              {subscribedContexts.has(contextKey)
                                ? "ON"
                                : "OFF"}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Hub Controls */}
        <div className="section-collapsible">
          <div
            className="section-header"
            onClick={() => setHubControlsCollapsed(!hubControlsCollapsed)}
          >
            <div
              className="section-chevron"
              style={{
                transform: hubControlsCollapsed
                  ? "rotate(0deg)"
                  : "rotate(90deg)",
              }}
            >
              ▶
            </div>
            <h2 className="section-title">Hub Controls</h2>
          </div>
          <div
            className={`section-content ${hubControlsCollapsed ? "collapsed" : ""}`}
          >
            <div className="section-inner">
              <div className="demo-card-section">
                <div className="demo-card-label">Activation Status</div>
                <div className="btn-group">
                  <button
                    onClick={() => hubSetActivationStatus("ENABLED")}
                    className={`btn-activation ${hubActivationStatus === "ENABLED" ? "enabled" : ""}`}
                  >
                    <span style={{ fontSize: "10px" }}>●</span>
                    ENABLED
                  </button>
                  <button
                    onClick={() => hubSetActivationStatus("LOADING")}
                    className={`btn-activation ${hubActivationStatus === "LOADING" ? "loading" : ""}`}
                  >
                    <span style={{ fontSize: "10px" }}>◐</span>
                    LOADING
                  </button>
                  <button
                    onClick={() => hubSetActivationStatus("DISABLED")}
                    className={`btn-activation ${hubActivationStatus === "DISABLED" ? "disabled" : ""}`}
                  >
                    <span style={{ fontSize: "10px" }}>✕</span>
                    DISABLED
                  </button>
                </div>
              </div>

              <div className="demo-card-section">
                <div className="demo-card-label">Tooltip Text</div>
                <div className="input-group">
                  <input
                    type="text"
                    value={tooltipText}
                    onChange={(e) => setTooltipText(e.target.value)}
                    placeholder="Enter tooltip text..."
                    className="input"
                  />
                  <button
                    onClick={hubApplyTooltip}
                    className="btn btn-primary btn-sm"
                  >
                    Set
                  </button>
                  <button onClick={hubClearTooltip} className="btn btn-sm">
                    Clear
                  </button>
                </div>
              </div>

              <div className="demo-card-section">
                <div className="demo-card-label">Notification Badge</div>
                <div className="input-group">
                  <div
                    className="toggle-switch"
                    onClick={hubToggleNotificationBadge}
                  >
                    <div
                      className={`toggle-track ${notificationBadgeActive ? "active" : ""}`}
                    >
                      <div className="toggle-thumb" />
                    </div>
                    <span className="toggle-label">
                      {notificationBadgeActive ? "ON" : "OFF"}
                    </span>
                  </div>
                  <input
                    type="number"
                    value={notificationBadgeCount}
                    onChange={(e) =>
                      setNotificationBadgeCount(parseInt(e.target.value) || 0)
                    }
                    className="input input-number"
                    style={{ marginLeft: "auto" }}
                  />
                </div>
              </div>

              <div className="demo-card-section">
                <div className="demo-card-label">Microphone Badge</div>
                <div
                  className="toggle-switch"
                  onClick={hubToggleMicrophoneBadge}
                >
                  <div
                    className={`toggle-track ${microphoneBadgeActive ? "active" : ""}`}
                  >
                    <div className="toggle-thumb" />
                  </div>
                  <span className="toggle-label">
                    {microphoneBadgeActive ? "ON" : "OFF"}
                  </span>
                </div>
              </div>

              <div className="demo-card-section">
                <div className="demo-card-label">Push Notification</div>
                <input
                  type="text"
                  value={pushNotificationText}
                  onChange={(e) => setPushNotificationText(e.target.value)}
                  placeholder="Notification text..."
                  className="input"
                  style={{ marginBottom: "var(--space-sm)" }}
                />
                <div className="input-group">
                  <input
                    type="number"
                    value={pushNotificationTimeout}
                    onChange={(e) =>
                      setPushNotificationTimeout(parseInt(e.target.value) || 12)
                    }
                    placeholder="Timeout (sec)"
                    className="input input-number"
                  />
                  <button
                    onClick={hubShowPushNotification}
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                  >
                    Show
                  </button>
                  <button
                    onClick={hubHidePushNotification}
                    className="btn btn-sm"
                  >
                    Hide
                  </button>
                </div>
              </div>

              <div className="demo-card-section">
                <div className="demo-card-label">
                  Multi-notification testing
                </div>
                {/* Fire N at once */}
                <div style={{ marginBottom: "var(--space-sm)" }}>
                  <div
                    style={{
                      fontSize: "var(--text-xs)",
                      color: "var(--color-text-muted)",
                      marginBottom: "var(--space-xs)",
                    }}
                  >
                    Fire burst (timeout 30s each)
                  </div>
                  <div className="btn-group">
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <button
                        key={n}
                        onClick={() => hubFireCount(n)}
                        className="btn btn-sm btn-primary"
                      >
                        ×{n}
                      </button>
                    ))}
                    <button
                      onClick={hubHidePushNotification}
                      className="btn btn-sm btn-danger"
                    >
                      Hide all
                    </button>
                  </div>
                </div>
                {/* Individual presets */}
                <div
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--color-text-muted)",
                    marginBottom: "var(--space-xs)",
                  }}
                >
                  Individual presets
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-xs)",
                  }}
                >
                  {MULTI_NOTIF_PRESETS.map((preset, i) => (
                    <button
                      key={i}
                      onClick={() => hubFirePreset(i)}
                      className="btn btn-sm"
                      style={{
                        textAlign: "left",
                        justifyContent: "flex-start",
                      }}
                    >
                      <span
                        style={{
                          opacity: 0.5,
                          marginRight: "6px",
                          fontFamily: "monospace",
                        }}
                      >
                        {i + 1}
                      </span>
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="demo-card-section">
                <div className="demo-card-label">App Control</div>
                <button
                  onClick={hubCloseApp}
                  className="btn btn-danger"
                  style={{ width: "100%" }}
                >
                  Close App
                </button>
              </div>

              <div className="demo-card-section">
                <div className="demo-card-label">App State Subscription</div>
                {!appStateSubscribed ? (
                  <button
                    onClick={hubSubscribeAppState}
                    className="btn btn-primary"
                    style={{ width: "100%" }}
                  >
                    Subscribe
                  </button>
                ) : (
                  <>
                    <button
                      onClick={hubUnsubscribeAppState}
                      className="btn"
                      style={{ width: "100%", marginBottom: "var(--space-sm)" }}
                    >
                      Unsubscribe
                    </button>
                    <div className="updater-card">
                      <div style={{ marginBottom: "var(--space-xs)" }}>
                        Status:{" "}
                        <strong>
                          {appStateIsOpen === null
                            ? "Unknown"
                            : appStateIsOpen
                              ? "OPEN"
                              : "CLOSED"}
                        </strong>
                      </div>
                      {appStateLog.length > 0 && (
                        <div
                          style={{
                            marginTop: "var(--space-sm)",
                            maxHeight: "120px",
                            overflowY: "auto",
                          }}
                        >
                          {appStateLog.map((entry, i) => (
                            <div key={i} className="log-entry">
                              <span className="log-timestamp">
                                {entry.timestamp}
                              </span>
                              <span
                                style={{
                                  color: entry.isOpen
                                    ? "var(--color-success)"
                                    : "var(--color-text-muted)",
                                  fontWeight: "var(--font-semibold)",
                                }}
                              >
                                {entry.isOpen ? "OPENED" : "CLOSED"}
                              </span>
                              {entry.trigger && (
                                <span
                                  style={{
                                    color: "var(--color-text-muted)",
                                    fontSize: "var(--text-xs)",
                                  }}
                                >
                                  {" "}
                                  ({entry.trigger})
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Event Preview */}
        <div className="section-collapsible">
          <div
            className="section-header"
            onClick={() => setEventPreviewCollapsed(!eventPreviewCollapsed)}
          >
            <div
              className="section-chevron"
              style={{
                transform: eventPreviewCollapsed
                  ? "rotate(0deg)"
                  : "rotate(90deg)",
              }}
            >
              ▶
            </div>
            <h2 className="section-title">Event Preview</h2>
          </div>
          <div
            className={`section-content ${eventPreviewCollapsed ? "collapsed" : ""}`}
          >
            <div className="section-inner">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "var(--space-lg)",
                }}
              >
                <div style={{ color: "var(--color-text-secondary)" }}>
                  {eventPreviews.length} event
                  {eventPreviews.length !== 1 ? "s" : ""}
                </div>
                {eventPreviews.length > 0 && (
                  <button
                    onClick={() => setEventPreviews([])}
                    className="btn btn-sm"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                {eventPreviews.length === 0 ? (
                  <p className="empty-state">
                    No events yet. Subscribe to events to see them here.
                  </p>
                ) : (
                  eventPreviews.map((event, index) => (
                    <div key={index} className="event-preview-card">
                      <div className="event-preview-header">
                        <div className="event-preview-title">{event.type}</div>
                        <div className="event-preview-time">
                          {new Date(event.timestamp).toLocaleTimeString()} •{" "}
                          {event.streamType}
                        </div>
                      </div>
                      <pre className="event-preview-code">
                        {JSON.stringify(event.data, null, 2)}
                      </pre>
                    </div>
                  ))
                )}
              </div>

              {/* Context Changes */}
              {contextChanges.length > 0 && (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      margin: "var(--space-xl) 0 var(--space-lg)",
                    }}
                  >
                    <div className="demo-card-label">Context Changes</div>
                    <button
                      onClick={() => setContextChanges([])}
                      className="btn btn-sm"
                    >
                      Clear
                    </button>
                  </div>
                  <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                    {contextChanges.map((change, index) => (
                      <div key={index} className="event-preview-card">
                        <div className="event-preview-header">
                          <div className="event-preview-title">
                            {change.contextKey}{" "}
                            <span
                              style={{
                                color: "var(--color-text-muted)",
                                fontWeight: "normal",
                              }}
                            >
                              ({change.changeType})
                            </span>
                          </div>
                          <div className="event-preview-time">
                            {new Date(change.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                        {change.changeType !== "closed" && (
                          <pre className="event-preview-code">
                            {JSON.stringify(change.currentData, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Active Updaters (Write to EHR) */}
        <div className="section-collapsible">
          <div
            className="section-header"
            onClick={() => setActiveUpdatersCollapsed(!activeUpdatersCollapsed)}
          >
            <div
              className="section-chevron"
              style={{
                transform: activeUpdatersCollapsed
                  ? "rotate(0deg)"
                  : "rotate(90deg)",
              }}
            >
              ▶
            </div>
            <h2 className="section-title">Active Updaters (Write to EHR)</h2>
          </div>
          <div
            className={`section-content ${activeUpdatersCollapsed ? "collapsed" : ""}`}
          >
            <div className="section-inner">
              <div className="demo-card-section">
                <div className="demo-card-label">
                  Available Updaters ({writebackEntries.length})
                </div>
                <div className="event-list">
                  {writebackEntries.length === 0 ? (
                    <div className="empty-state">No updaters available</div>
                  ) : (
                    writebackEntries.map((upd, idx: number) => {
                      const isActive =
                        activeUpdaters.has(upd.entityType) &&
                        activeUpdaters
                          .get(upd.entityType)!
                          .has(`${upd.entityType}:${upd.fieldPath}`);
                      return (
                        <div
                          key={`${upd.entityType}-${upd.fieldPath}-${idx}`}
                          className="event-item"
                        >
                          <div>
                            <div className="event-name">{upd.fieldPath}</div>
                            <div
                              style={{
                                fontSize: "var(--text-xs)",
                                color: "var(--color-text-muted)",
                              }}
                            >
                              {upd.entityType}
                              {upd.disruptive ? " • requires permission" : ""}
                            </div>
                          </div>
                          <div
                            className="toggle-switch"
                            onClick={() =>
                              toggleUpdater(upd.entityType, upd.fieldPath, "")
                            }
                          >
                            <div
                              className={`toggle-track ${isActive ? "active" : ""}`}
                            >
                              <div className="toggle-thumb" />
                            </div>
                            <span className="toggle-label">
                              {isActive ? "ON" : "OFF"}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Active Updater Controls */}
              {activeUpdaters.size > 0 && (
                <div className="demo-card-section">
                  <div className="demo-card-label">Update Controls</div>
                  {Array.from(activeUpdaters.entries()).map(
                    ([entityTypeKey, updaterMap]) => (
                      <div
                        key={entityTypeKey}
                        style={{ marginBottom: "var(--space-md)" }}
                      >
                        <div
                          className="demo-card-label"
                          style={{ marginBottom: "var(--space-sm)" }}
                        >
                          {entityTypeKey}
                        </div>
                        {Array.from(updaterMap.entries()).map(
                          ([key, updater]) => {
                            const cap =
                              (vimSDK?.ehr?.context as any)?.[
                                updater.entityType
                              ]?.getCapability("update");
                            const detected = cap?.available ?? false;
                            return (
                              <div
                                key={key}
                                className={`updater-card ${!detected ? "disabled" : ""}`}
                              >
                                <div className="updater-card-header">
                                  {updater.fieldPath}
                                  {!detected && (
                                    <span className="updater-warning">
                                      (not in context)
                                    </span>
                                  )}
                                </div>
                                <div className="input-group">
                                  <input
                                    type="text"
                                    value={updater.value}
                                    onChange={(e) =>
                                      updateUpdaterValue(
                                        entityTypeKey,
                                        key,
                                        e.target.value,
                                      )
                                    }
                                    placeholder="Enter value..."
                                    disabled={!detected}
                                    className="input"
                                  />
                                  <select
                                    value={updater.mode}
                                    onChange={(e) =>
                                      updateUpdaterMode(
                                        entityTypeKey,
                                        key,
                                        e.target.value as "override" | "append",
                                      )
                                    }
                                    disabled={!detected}
                                    className="input"
                                  >
                                    <option value="override">Override</option>
                                    <option value="append">Append</option>
                                  </select>
                                </div>
                                <button
                                  onClick={() => executeUpdate(updater)}
                                  disabled={!detected}
                                  className="btn btn-primary"
                                  style={{
                                    width: "100%",
                                    opacity: detected ? 1 : 0.5,
                                  }}
                                >
                                  Update
                                </button>
                              </div>
                            );
                          },
                        )}
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Activity Log */}
        <div className="section-collapsible">
          <div
            className="section-header"
            onClick={() => setActivityLogCollapsed(!activityLogCollapsed)}
          >
            <div
              className="section-chevron"
              style={{
                transform: activityLogCollapsed
                  ? "rotate(0deg)"
                  : "rotate(90deg)",
              }}
            >
              ▶
            </div>
            <h2 className="section-title">Activity Log</h2>
          </div>
          <div
            className={`section-content ${activityLogCollapsed ? "collapsed" : ""}`}
          >
            <div className="section-inner">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "var(--space-lg)",
                }}
              >
                <div style={{ color: "var(--color-text-secondary)" }}>
                  {logEntries.length} log entr
                  {logEntries.length !== 1 ? "ies" : "y"}
                </div>
                {logEntries.length > 0 && (
                  <button
                    onClick={() => setLogEntries([])}
                    className="btn btn-sm"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="activity-log">
                {logEntries.length === 0 ? (
                  <p className="empty-state">No activity yet</p>
                ) : (
                  logEntries.map((entry, index) => (
                    <div key={index} className={`log-entry ${entry.type}`}>
                      <span className="log-timestamp">{entry.timestamp}</span>{" "}
                      {entry.message}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SDK Manifest Modal */}
      {manifestModalOpen && (
        <div
          className="modal-overlay"
          onClick={() => setManifestModalOpen(false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">SDK Manifest</h2>
              <button
                className="modal-close"
                onClick={() => setManifestModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <pre className="modal-json">
                {JSON.stringify(manifest, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Main App Page with Suspense boundary
 */
export default function AppPage() {
  return (
    <Suspense
      fallback={
        <div className="loading-container">
          <div className="loading-content">
            <div className="spinner" style={{ margin: "0 auto 16px" }} />
            <p style={{ color: "var(--color-text-muted)" }}>Loading...</p>
          </div>
        </div>
      }
    >
      <AppPageContent />
    </Suspense>
  );
}
