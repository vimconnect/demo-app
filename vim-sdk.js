'use strict';

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise, SuppressedError, Symbol, Iterator */


function __classPrivateFieldGet(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}

function __classPrivateFieldSet(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

/**
 * Permission Manager for SDK
 *
 * SECURITY: Simple cache + validation-at-execution model
 *
 * Memory Cache (in-memory only):
 *   - Stores granted permissions for fast UI checks
 *   - Used by isPermitted() to enable/disable buttons
 *   - Synced from extension on initialization (handshake)
 *   - Cleared on page reload (re-synced on init)
 *   - Can be manipulated by app - doesn't affect security
 *   - Updated when permissions are granted
 *
 * Validation (at SDKBridge layer):
 *   - execute() sends operation to SDKBridge
 *   - SDKBridge validates against chrome.storage (secure)
 *   - If invalid, returns PERMISSION_DENIED error
 *   - Cannot be bypassed even if cache is manipulated
 *
 * Permission Flow:
 * 1. SDK initializes → extension sends current permissions
 * 2. SDK syncs cache from extension (single source of truth)
 * 3. requestAttendedAutomation() → request & cache permissions
 * 4. isPermitted() → check cache (fast, UI only)
 * 5. execute() → SDKBridge validates (secure, enforcement)
 * 6. requestPermission() → request additional permissions
 */
/**
 * Permission Manager for SDK
 *
 * SECURITY: Two-tier permission system
 */
class SDKPermissionManager {
    /**
     * Initialize with MessagePort for communication with extension
     * Permissions are synced from extension during SDK initialization
     */
    static initialize(port) {
        this.port = port;
        console.log('[SDK PermissionManager] Initialized with MessagePort (memory cache)');
    }
    /**
     * Sync permissions from extension (called during handshake)
     * Extension is the source of truth, SDK caches in memory
     */
    static syncFromExtension(permissions) {
        this.cache = permissions || [];
        console.log(`[SDK PermissionManager] Synced ${this.cache.length} permission(s) from extension`);
    }
    /**
     * Check cached permission (synchronous, for UI/UX)
     * NOTE: This can be manipulated by app, but doesn't affect security.
     * execute() always validates with extension.
     */
    static checkCachedPermission(entity, fields, context) {
        // Clean up expired permissions
        this.cleanupExpired();
        for (const permission of this.cache) {
            if (this.matchesEntity(permission.entity, entity) &&
                this.matchesFields(permission.fields, fields) &&
                this.matchesContext(permission.context, context) &&
                !this.isExpired(permission)) {
                return true;
            }
        }
        return false;
    }
    /**
     * Request permission from user
     * Sends request to extension, which shows prompt and stores result
     * Also caches permission locally for fast UI checks
     */
    static async requestPermission(request) {
        if (this.port === null) {
            console.error('[SDK PermissionManager] Not initialized - no MessagePort');
            return { granted: false, reason: 'SDK not initialized' };
        }
        try {
            // Send request permission message to extension
            const response = await this.sendMessage({
                type: 'requestPermission',
                payload: request,
            });
            // If granted, cache permission locally
            if (response?.granted === true && response.permission !== undefined) {
                this.cachePermission(response.permission);
            }
            return {
                granted: response?.granted === true,
                reason: response?.reason,
            };
        }
        catch (error) {
            console.error('[SDK PermissionManager] Failed to request permission:', error);
            return {
                granted: false,
                reason: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    /**
     * Cache a permission in memory (after successful grant)
     * Extension is the source of truth, this is just a local cache
     */
    static cachePermission(permission) {
        this.cache.push(permission);
        // No need to save - memory cache only, extension has the real state
    }
    /**
     * Send message to extension via MessagePort and wait for response
     */
    static async sendMessage(message) {
        if (this.port === null) {
            throw new Error('MessagePort not initialized');
        }
        return new Promise((resolve, reject) => {
            // Create response channel
            const channel = new MessageChannel();
            const timeout = setTimeout(() => {
                reject(new Error('Permission request timeout'));
            }, 10000); // 10 second timeout
            // Listen for response
            channel.port1.onmessage = (event) => {
                clearTimeout(timeout);
                resolve(event.data);
            };
            // Send message with response port
            try {
                this.port.postMessage(message, [channel.port2]);
            }
            catch (error) {
                clearTimeout(timeout);
                reject(error);
            }
        });
    }
    // ============================================================================
    // Cache Helper Methods
    // ============================================================================
    /**
     * Clean up expired permissions from cache
     */
    static cleanupExpired() {
        this.cache = this.cache.filter(p => !this.isExpired(p));
        // No need to save - memory cache only
    }
    /**
     * Check if permission is expired
     */
    static isExpired(permission) {
        if (permission.expiresAt === undefined) {
            return false;
        }
        return Date.now() > permission.expiresAt;
    }
    /**
     * Check if entity matches permission
     */
    static matchesEntity(permissionEntity, requestedEntity) {
        return permissionEntity === '*' || permissionEntity === requestedEntity;
    }
    /**
     * Check if fields match permission
     */
    static matchesFields(permissionFields, requestedFields) {
        // If permission is wildcard, all fields are granted
        if (permissionFields === '*') {
            return true;
        }
        // If requesting wildcard but permission is specific, no match
        if (requestedFields === '*') {
            return false; // permissionFields is not '*' at this point
        }
        // Check if all requested fields are in permission
        return requestedFields.every(field => permissionFields.includes(field));
    }
    /**
     * Check if context matches permission
     */
    static matchesContext(permissionContext, requestedContext) {
        // Context operations: 'context' and 'workflow' are equivalent (workflow is deprecated)
        if (permissionContext.type === 'context' || permissionContext.type === 'workflow') {
            return requestedContext.type === 'context' || requestedContext.type === 'workflow';
        }
        if (requestedContext.type !== 'api') {
            return false;
        }
        if (permissionContext.entityId === '*') {
            return true;
        }
        return permissionContext.entityId === requestedContext.entityId;
    }
}
SDKPermissionManager.port = null;
SDKPermissionManager.cache = []; // In-memory only, synced from extension

/**
 * Vim Connect SDK Client
 * Complete rewrite for team-reviewed design
 *
 * PROTOCOL: Standard MessageChannel pattern shared across Vim Connect
 * - Same pattern used by: SDKClient.ts (SDK), PreviewOverlay.tsx (overlays)
 * - Protocol documentation: docs/messagechannel-protocol.md
 * - IMPORTANT: Changes here must be reflected in PreviewOverlay.tsx
 *
 * Related implementations:
 * - Parent side: extensions/vim-connect/src/sidepanel/services/sdk-bridge.ts
 * - Overlay pattern: extensions/vim-connect/src/content/components/PreviewOverlay.tsx
 */
var _SDKClient_instances, _a, _SDKClient_instance, _SDKClient_port, _SDKClient_manifest, _SDKClient_status, _SDKClient_options, _SDKClient_readyCallbacks, _SDKClient_entityNamespaces, _SDKClient_eventTarget, _SDKClient_activeWorkflowSubscriptions, _SDKClient_activeContextSubscriptions, _SDKClient_hasUpdatableSubscribers, _SDKClient_currentUpdatableEntities, _SDKClient_isAppOpen, _SDKClient_hubEventTarget, _SDKClient_pushNotificationCallbacks, _SDKClient_initialize, _SDKClient_initializeNamespaces, _SDKClient_createNamespace, _SDKClient_executeOperation, _SDKClient_executeGetById, _SDKClient_executeSearch, _SDKClient_flattenObject, _SDKClient_executeUpdateById, _SDKClient_executeCreate, _SDKClient_getStatus, _SDKClient_waitUntilReady, _SDKClient_validateEventTypes, _SDKClient_validateContextKey, _SDKClient_workflowOn, _SDKClient_workflowOff, _SDKClient_contextOnChange, _SDKClient_getUpdatableEntities, _SDKClient_contextUpdate, _SDKClient_updatePatient, _SDKClient_updateEncounter, _SDKClient_updateReferral, _SDKClient_updateOrder, _SDKClient_updateClaim, _SDKClient_validateContextOperation, _SDKClient_requestAttendedAutomation, _SDKClient_hubSetActivationStatus, _SDKClient_hubSetTooltipText, _SDKClient_hubNotificationBadgeSet, _SDKClient_hubNotificationBadgeHide, _SDKClient_hubPushNotificationShow, _SDKClient_hubPushNotificationHide, _SDKClient_hubMicrophoneBadgeShow, _SDKClient_hubMicrophoneBadgeHide, _SDKClient_hubCloseApp, _SDKClient_hubAppStateSubscribe, _SDKClient_handleHubAppStateChange, _SDKClient_handlePushNotificationButtonClicked, _SDKClient_getManifest, _SDKClient_createAPI, _SDKClient_handleMessage, _SDKClient_handleWorkflowEvent, _SDKClient_handleContextChange, _SDKClient_handleUpdatableEntitiesChange, _SDKClient_handleError, _SDKClient_send, _SDKClient_sendRequest, _SDKClient_ensureConnected, _SDKClient_log;
/**
 * SDK Error Class
 */
class SDKError extends Error {
    constructor(message, code, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'SDKError';
    }
}
/**
 * OperationHandle - Handle for a single operation (context or API)
 * Provides execute, isPermitted, and requestPermission methods
 */
class OperationHandle {
    constructor(operationName, entityType, grantedFields, availableFields, isDisruptive, isAPIOperation, executeFn) {
        this.operationName = operationName;
        this.entityType = entityType;
        this.grantedFields = grantedFields === '*' ? '*' : new Set(grantedFields);
        this.availableFields = availableFields;
        this.isDisruptive = isDisruptive;
        this.isAPIOperation = isAPIOperation;
        this.executeFn = executeFn;
    }
    /**
     * Execute the operation with given data
     * Validates with extension before executing (secure)
     *
     * For context operations: execute(data)
     * For API operations: execute(entityId, data)
     */
    async execute(...args) {
        // Parse arguments based on operation type
        let data;
        let entityId;
        if (this.isAPIOperation) {
            // API operation: execute(entityId, data?)
            [entityId, data = {}] = args;
            if (!entityId) {
                throw new SDKError(`API operation requires entityId as first argument`, 'INVALID_ARGUMENTS', { operation: this.operationName });
            }
        }
        else {
            // Context operation: execute(data)
            [data] = args;
        }
        const fields = Object.keys(data);
        // If operation is disruptive, require permission
        if (this.isDisruptive) {
            // For read operations (no fields to write), just verify requestAttendedAutomation was called
            // For write operations (has fields), verify specific fields were granted
            const isWriteOperation = fields.length > 0;
            if (isWriteOperation) {
                // Write operation: check if all requested fields are granted
                // Wildcard '*' grants permission to all fields
                if (this.grantedFields !== '*') {
                    const grantedFieldsSet = this.grantedFields; // TypeScript knows this is Set<string> here
                    if (grantedFieldsSet.size === 0) {
                        throw new SDKError(`Disruptive operation requires permission. Call requestPermission() first via requestAttendedAutomation().`, 'PERMISSION_REQUIRED', { operation: this.operationName, fields });
                    }
                    const ungrantedFields = fields.filter(field => !grantedFieldsSet.has(field));
                    if (ungrantedFields.length > 0) {
                        throw new SDKError(`Fields not permitted: ${ungrantedFields.join(', ')}. Call requestPermission([${ungrantedFields.map(f => `'${f}'`).join(', ')}]) first.`, 'PERMISSION_DENIED', { operation: this.operationName, ungrantedFields });
                    }
                }
            }
            // For read operations, permission is implicitly granted by having the OperationHandle
            // (created by requestAttendedAutomation), so no check needed
        }
        // Send to extension for execution
        // Extension (SDKBridge) will validate permissions again (secure enforcement)
        if (this.isAPIOperation) {
            // For API operations, pass entityId in the data
            return this.executeFn(this.entityType, { entityId, ...data });
        }
        else {
            // For context operations, just pass data
            return this.executeFn(this.entityType, data);
        }
    }
    /**
     * Check if specific fields are permitted (synchronous, cache check)
     */
    isPermitted(fields) {
        // Wildcard grants permission to all fields
        if (this.grantedFields === '*') {
            return true;
        }
        const grantedFieldsSet = this.grantedFields; // TypeScript knows this is Set<string> here
        return fields.every(field => grantedFieldsSet.has(field));
    }
    /**
     * Request permission for additional fields at runtime
     */
    async requestPermission(fields) {
        // If wildcard already granted, no need to request more
        if (this.grantedFields === '*') {
            return true;
        }
        // Validate fields are available in manifest
        const unavailableFields = fields.filter(field => !this.availableFields.includes(field));
        if (unavailableFields.length > 0) {
            throw new SDKError(`Fields not available: ${unavailableFields.join(', ')}`, 'FIELDS_NOT_AVAILABLE', { operation: this.operationName, unavailableFields });
        }
        // Request permission
        const result = await SDKPermissionManager.requestPermission({
            entity: this.entityType,
            fields,
            context: { type: 'context' },
            capabilities: ['dom', 'network', 'navigation'],
            ttl: 'session'
        });
        if (result.granted) {
            // Add to granted fields (safe because we checked it's not '*' above)
            fields.forEach(field => this.grantedFields.add(field));
        }
        return result.granted;
    }
}
/**
 * SDKClient - Main SDK implementation
 *
 * This class provides the window.vimSDK API for app developers.
 * It communicates with the Vim Connect extension via MessageChannel.
 */
class SDKClient {
    constructor(options = {}) {
        _SDKClient_instances.add(this);
        _SDKClient_port.set(this, null);
        _SDKClient_manifest.set(this, null);
        _SDKClient_status.set(this, 'disconnected');
        _SDKClient_options.set(this, void 0);
        _SDKClient_readyCallbacks.set(this, new Set());
        // Pre-created entity namespace proxies (v3.0 - Catalog-based SDK)
        _SDKClient_entityNamespaces.set(this, new Map());
        // EventTarget for all event management (replaces manual callback tracking)
        _SDKClient_eventTarget.set(this, new EventTarget());
        // Track active subscriptions for extension notifications
        _SDKClient_activeWorkflowSubscriptions.set(this, new Set());
        _SDKClient_activeContextSubscriptions.set(this, new Set());
        _SDKClient_hasUpdatableSubscribers.set(this, false);
        // Updatable entities current state
        _SDKClient_currentUpdatableEntities.set(this, null);
        // Hub state
        _SDKClient_isAppOpen.set(this, false);
        _SDKClient_hubEventTarget.set(this, new EventTarget());
        // notificationId → { left?: callback, right?: callback }
        _SDKClient_pushNotificationCallbacks.set(this, new Map());
        __classPrivateFieldSet(this, _SDKClient_options, {
            debug: options.debug ?? false,
            timeout: options.timeout ?? 10000
        }, "f");
        // Note: PermissionManager initialized after connection established (needs MessagePort)
        __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'SDK Client initialized');
    }
    // ============================================================================
    // Static Methods (Public API)
    // ============================================================================
    /**
     * Initialize Vim SDK
     * Called by app developer to connect to Vim Connect extension
     */
    static init(options = {}) {
        return new Promise((resolve, reject) => {
            var _b, _c;
            if (__classPrivateFieldGet(_a, _a, "f", _SDKClient_instance) && __classPrivateFieldGet((_b = __classPrivateFieldGet(_a, _a, "f", _SDKClient_instance)), _SDKClient_instances, "m", _SDKClient_getStatus).call(_b) === 'connected') {
                resolve(__classPrivateFieldGet((_c = __classPrivateFieldGet(_a, _a, "f", _SDKClient_instance)), _SDKClient_instances, "m", _SDKClient_createAPI).call(_c));
                return;
            }
            __classPrivateFieldSet(_a, _a, new _a(options), "f", _SDKClient_instance);
            // Listen for initialization message from extension
            window.addEventListener('message', (event) => {
                var _b;
                if (event.data.type === 'VIM_SDK_INIT' && event.ports[0]) {
                    const port = event.ports[0];
                    const manifest = event.data.manifest;
                    const permissions = event.data.permissions || []; // Extension sends permissions (source of truth)
                    __classPrivateFieldGet((_b = __classPrivateFieldGet(_a, _a, "f", _SDKClient_instance)), _SDKClient_instances, "m", _SDKClient_initialize).call(_b, port, manifest, permissions).then(() => {
                        var _b;
                        const api = __classPrivateFieldGet((_b = __classPrivateFieldGet(_a, _a, "f", _SDKClient_instance)), _SDKClient_instances, "m", _SDKClient_createAPI).call(_b);
                        resolve(api);
                    }).catch(reject);
                }
            });
            // Notify extension that app is ready for SDK
            const targetWindow = window.parent !== window ? window.parent : window;
            targetWindow.postMessage({ type: 'VIM_SDK_READY' }, '*');
            // Timeout if no response from extension
            setTimeout(() => {
                var _b;
                if (__classPrivateFieldGet(_a, _a, "f", _SDKClient_instance) && __classPrivateFieldGet((_b = __classPrivateFieldGet(_a, _a, "f", _SDKClient_instance)), _SDKClient_instances, "m", _SDKClient_getStatus).call(_b) !== 'connected') {
                    reject(new SDKError('Vim Connect extension not found. Please install the extension.', 'EXTENSION_NOT_FOUND'));
                }
            }, options.timeout || 10000);
        });
    }
    /**
     * Get current SDK instance (if initialized)
     */
    static get() {
        var _b, _c;
        if (__classPrivateFieldGet(_a, _a, "f", _SDKClient_instance) && __classPrivateFieldGet((_b = __classPrivateFieldGet(_a, _a, "f", _SDKClient_instance)), _SDKClient_instances, "m", _SDKClient_getStatus).call(_b) === 'connected') {
            return __classPrivateFieldGet((_c = __classPrivateFieldGet(_a, _a, "f", _SDKClient_instance)), _SDKClient_instances, "m", _SDKClient_createAPI).call(_c);
        }
        return null;
    }
}
_a = SDKClient, _SDKClient_port = new WeakMap(), _SDKClient_manifest = new WeakMap(), _SDKClient_status = new WeakMap(), _SDKClient_options = new WeakMap(), _SDKClient_readyCallbacks = new WeakMap(), _SDKClient_entityNamespaces = new WeakMap(), _SDKClient_eventTarget = new WeakMap(), _SDKClient_activeWorkflowSubscriptions = new WeakMap(), _SDKClient_activeContextSubscriptions = new WeakMap(), _SDKClient_hasUpdatableSubscribers = new WeakMap(), _SDKClient_currentUpdatableEntities = new WeakMap(), _SDKClient_isAppOpen = new WeakMap(), _SDKClient_hubEventTarget = new WeakMap(), _SDKClient_pushNotificationCallbacks = new WeakMap(), _SDKClient_instances = new WeakSet(), _SDKClient_initialize = 
/**
 * Initialize connection with Vim Connect extension
 * Private method - called automatically when extension establishes MessageChannel
 */
async function _SDKClient_initialize(port, manifest, permissions) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Initializing SDK with port, manifest, and permissions');
    __classPrivateFieldSet(this, _SDKClient_port, port, "f");
    __classPrivateFieldSet(this, _SDKClient_manifest, manifest, "f");
    __classPrivateFieldSet(this, _SDKClient_status, 'connected', "f");
    // Initialize permission manager with MessagePort
    // SECURITY: Permission validation happens at extension layer, not in app iframe
    SDKPermissionManager.initialize(port);
    // Sync permissions from extension (extension is source of truth)
    // SDK maintains memory-only cache, synced on init
    SDKPermissionManager.syncFromExtension(permissions);
    // Initialize namespace proxies from manifest (v3.0)
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_initializeNamespaces).call(this);
    // Listen to messages from extension
    __classPrivateFieldGet(this, _SDKClient_port, "f").onmessage = (e) => __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_handleMessage).call(this, e);
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'SDK connected', { manifest, permissions: `${permissions.length} permission(s)` });
    // Notify all waiting callbacks
    __classPrivateFieldGet(this, _SDKClient_readyCallbacks, "f").forEach(callback => callback());
    __classPrivateFieldGet(this, _SDKClient_readyCallbacks, "f").clear();
}, _SDKClient_initializeNamespaces = function _SDKClient_initializeNamespaces() {
    if (__classPrivateFieldGet(this, _SDKClient_manifest, "f") == null || __classPrivateFieldGet(this, _SDKClient_manifest, "f").operations == null) {
        return;
    }
    // Group operations by namespace
    const operationsByNamespace = new Map();
    for (const operation of __classPrivateFieldGet(this, _SDKClient_manifest, "f").operations) {
        const ops = operationsByNamespace.get(operation.sdkNamespace) ?? [];
        ops.push(operation);
        operationsByNamespace.set(operation.sdkNamespace, ops);
    }
    // Create namespaces with actual functions for each entity
    __classPrivateFieldGet(this, _SDKClient_entityNamespaces, "f").clear();
    for (const [namespace, operations] of operationsByNamespace.entries()) {
        __classPrivateFieldGet(this, _SDKClient_entityNamespaces, "f").set(namespace, __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_createNamespace).call(this, namespace, operations));
    }
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Initialized entity namespaces', {
        namespaces: Array.from(__classPrivateFieldGet(this, _SDKClient_entityNamespaces, "f").keys())
    });
}, _SDKClient_createNamespace = function _SDKClient_createNamespace(namespace, operations) {
    const operationMap = new Map(operations.map(op => [op.sdkMethod, op]));
    // Create namespace object with actual functions
    const namespaceObj = {
        // Add hasCapability method at entity level
        hasCapability: (method) => {
            const operation = operationMap.get(method);
            return operation?.available ?? false;
        }
    };
    // Create actual functions for each operation
    for (const operation of operations) {
        const methodName = operation.sdkMethod;
        // Create a wrapper function that validates before executing
        namespaceObj[methodName] = (async (...args) => {
            // Validate operation exists (should always be true since we're iterating)
            if (operation == null) {
                throw new SDKError(`Operation "${namespace}.${methodName}" does not exist in API catalog`, 'NOT_EXISTS', { namespace, method: methodName });
            }
            // Validate operation is available/implemented
            if (!operation.available) {
                throw new SDKError(`Operation "${namespace}.${methodName}" is not implemented for the current system`, 'NOT_IMPLEMENTED', {
                    namespace,
                    method: methodName,
                    catalogEntryId: operation.catalogEntryId
                });
            }
            // Execute the operation based on type
            return __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_executeOperation).call(this, operation, args);
        });
    }
    return namespaceObj;
}, _SDKClient_executeOperation = function _SDKClient_executeOperation(operation, args) {
    const { operationType } = operation;
    switch (operationType) {
        case 'getById':
            return __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_executeGetById).call(this, operation, args[0]);
        case 'search':
            return __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_executeSearch).call(this, operation, args[0]);
        case 'updateById':
            return __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_executeUpdateById).call(this, operation, args[0], args[1]);
        case 'create':
            return __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_executeCreate).call(this, operation, args[0]);
        default:
            throw new SDKError(`Unknown operation type: ${operationType}`, 'INVALID_OPERATION', { operationType });
    }
}, _SDKClient_executeGetById = 
/**
 * Execute getById operation
 */
async function _SDKClient_executeGetById(operation, ids) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    const metadata = operation.metadata;
    const requiredIds = metadata.idParameterNames;
    // Validate ALL required IDs are provided
    // NOTE: ALL IDs in idParameterNames are required (no optional IDs)
    for (const idParam of requiredIds) {
        if (!ids[idParam]) {
            throw new SDKError(`Missing required ID parameter: ${idParam}`, 'MISSING_REQUIRED_PARAMETER', { operation: `${operation.sdkNamespace}.${operation.sdkMethod}`, parameter: idParam });
        }
    }
    // Check if operation is disruptive
    if (operation.disruptive) {
        throw new SDKError(`Operation "${operation.sdkNamespace}.${operation.sdkMethod}" is disruptive and requires permission`, 'PERMISSION_REQUIRED', { operation: `${operation.sdkNamespace}.${operation.sdkMethod}` });
    }
    return __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_sendRequest).call(this, {
        type: 'api:catalog',
        payload: {
            catalogEntryId: operation.catalogEntryId,
            params: ids // Spread all IDs directly
        }
    });
}, _SDKClient_executeSearch = 
/**
 * Execute search operation
 */
async function _SDKClient_executeSearch(operation, params) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    // Check if operation is disruptive
    if (operation.disruptive) {
        throw new SDKError(`Operation "${operation.sdkNamespace}.${operation.sdkMethod}" is disruptive and requires permission`, 'PERMISSION_REQUIRED', { operation: `${operation.sdkNamespace}.${operation.sdkMethod}` });
    }
    return __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_sendRequest).call(this, {
        type: 'api:catalog',
        payload: {
            catalogEntryId: operation.catalogEntryId,
            params
        }
    });
}, _SDKClient_flattenObject = function _SDKClient_flattenObject(obj, prefix = '') {
    const flattened = {};
    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        // Recursively flatten nested objects (but not arrays or null)
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(flattened, __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_flattenObject).call(this, value, fullKey));
        }
        else {
            flattened[fullKey] = value;
        }
    }
    return flattened;
}, _SDKClient_executeUpdateById = 
/**
 * Execute updateById operation
 */
async function _SDKClient_executeUpdateById(operation, ids, data) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    const metadata = operation.metadata;
    const requiredIds = metadata.idParameterNames;
    // Validate all required IDs are provided
    for (const idParam of requiredIds) {
        if (!ids[idParam]) {
            throw new SDKError(`Missing required ID parameter: ${idParam}`, 'MISSING_REQUIRED_PARAMETER', { operation: `${operation.sdkNamespace}.${operation.sdkMethod}`, parameter: idParam });
        }
    }
    // Check if operation is disruptive
    if (operation.disruptive) {
        throw new SDKError(`Operation "${operation.sdkNamespace}.${operation.sdkMethod}" is disruptive and requires permission`, 'PERMISSION_REQUIRED', { operation: `${operation.sdkNamespace}.${operation.sdkMethod}` });
    }
    // Flatten nested data object before sending
    const flattenedData = __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_flattenObject).call(this, data);
    return __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_sendRequest).call(this, {
        type: 'api:catalog',
        payload: {
            catalogEntryId: operation.catalogEntryId,
            params: {
                ...ids, // Spread all IDs
                ...flattenedData
            }
        }
    });
}, _SDKClient_executeCreate = 
/**
 * Execute create operation
 */
async function _SDKClient_executeCreate(operation, data) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    // Check if operation is disruptive
    if (operation.disruptive) {
        throw new SDKError(`Operation "${operation.sdkNamespace}.${operation.sdkMethod}" is disruptive and requires permission`, 'PERMISSION_REQUIRED', { operation: `${operation.sdkNamespace}.${operation.sdkMethod}` });
    }
    // Flatten nested data object before sending
    const flattenedData = __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_flattenObject).call(this, data);
    return __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_sendRequest).call(this, {
        type: 'api:catalog',
        payload: {
            catalogEntryId: operation.catalogEntryId,
            params: flattenedData
        }
    });
}, _SDKClient_getStatus = function _SDKClient_getStatus() {
    return __classPrivateFieldGet(this, _SDKClient_status, "f");
}, _SDKClient_waitUntilReady = function _SDKClient_waitUntilReady(options = {}) {
    // Already connected
    if (__classPrivateFieldGet(this, _SDKClient_status, "f") === 'connected') {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const timeout = options.timeout ?? __classPrivateFieldGet(this, _SDKClient_options, "f").timeout ?? 10000;
        const timeoutId = setTimeout(() => {
            __classPrivateFieldGet(this, _SDKClient_readyCallbacks, "f").delete(callback);
            reject(new SDKError('SDK connection timeout. Make sure Vim Connect extension is installed.', 'CONNECTION_TIMEOUT'));
        }, timeout);
        const callback = () => {
            clearTimeout(timeoutId);
            resolve();
        };
        __classPrivateFieldGet(this, _SDKClient_readyCallbacks, "f").add(callback);
    });
}, _SDKClient_validateEventTypes = function _SDKClient_validateEventTypes(eventTypes) {
    if (!__classPrivateFieldGet(this, _SDKClient_manifest, "f")) {
        throw new Error('[Vim SDK] Cannot validate event types: manifest not loaded');
    }
    const supportedEventIds = __classPrivateFieldGet(this, _SDKClient_manifest, "f").supportedEvents.map(e => e.id);
    for (const eventType of eventTypes) {
        if (!supportedEventIds.includes(eventType)) {
            throw new Error(`[Vim SDK] Invalid event type: "${eventType}". ` +
                `Supported events: ${supportedEventIds.join(', ')}`);
        }
    }
}, _SDKClient_validateContextKey = function _SDKClient_validateContextKey(contextKey) {
    if (!__classPrivateFieldGet(this, _SDKClient_manifest, "f")) {
        throw new Error('[Vim SDK] Cannot validate context key: manifest not loaded');
    }
    const supportedContextKeys = __classPrivateFieldGet(this, _SDKClient_manifest, "f").supportedContexts.map(c => c.contextKey);
    if (!supportedContextKeys.includes(contextKey)) {
        throw new Error(`[Vim SDK] Invalid context key: "${contextKey}". ` +
            `Supported contexts: ${supportedContextKeys.join(', ')}`);
    }
}, _SDKClient_workflowOn = function _SDKClient_workflowOn(eventTypes, callback) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
    // Validate event types exist in manifest
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_validateEventTypes).call(this, types);
    // Wrap callback to extract event data from CustomEvent
    const wrappedCallback = ((event) => {
        const customEvent = event;
        callback(customEvent.detail);
    });
    // Store wrapped callback on the original for cleanup
    callback.__wrappedListener = wrappedCallback;
    types.forEach(eventType => {
        const eventName = `workflow:${eventType}`;
        // Notify extension of first subscription
        if (!__classPrivateFieldGet(this, _SDKClient_activeWorkflowSubscriptions, "f").has(eventType)) {
            __classPrivateFieldGet(this, _SDKClient_activeWorkflowSubscriptions, "f").add(eventType);
            __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_send).call(this, { type: 'subscribe:workflow', payload: { eventType } });
            __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Subscribed to workflow event', { eventType });
        }
        __classPrivateFieldGet(this, _SDKClient_eventTarget, "f").addEventListener(eventName, wrappedCallback);
    });
    return () => {
        types.forEach(eventType => {
            const eventName = `workflow:${eventType}`;
            __classPrivateFieldGet(this, _SDKClient_eventTarget, "f").removeEventListener(eventName, wrappedCallback);
            // Check if any listeners remain for this event type
            // Note: EventTarget doesn't provide a way to check listener count,
            // so we track subscriptions manually
            // For simplicity, we'll unsubscribe from extension on removal
            // (could be optimized by tracking listener count)
            if (__classPrivateFieldGet(this, _SDKClient_activeWorkflowSubscriptions, "f").has(eventType)) {
                __classPrivateFieldGet(this, _SDKClient_activeWorkflowSubscriptions, "f").delete(eventType);
                __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_send).call(this, { type: 'unsubscribe:workflow', payload: { eventType } });
                __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Unsubscribed from workflow event', { eventType });
            }
        });
    };
}, _SDKClient_workflowOff = function _SDKClient_workflowOff(eventTypes, callback) {
    const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
    const wrappedCallback = callback.__wrappedListener;
    if (!wrappedCallback)
        return;
    types.forEach(eventType => {
        const eventName = `workflow:${eventType}`;
        __classPrivateFieldGet(this, _SDKClient_eventTarget, "f").removeEventListener(eventName, wrappedCallback);
    });
}, _SDKClient_contextOnChange = function _SDKClient_contextOnChange(contextKey, callback) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    // Validate context key exists in manifest
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_validateContextKey).call(this, contextKey);
    // Wrap callback to extract event data from CustomEvent
    const wrappedCallback = ((event) => {
        const customEvent = event;
        const { previousData, currentData } = customEvent.detail;
        callback(previousData, currentData);
    });
    // Store wrapped callback on the original for cleanup
    callback.__wrappedListener = wrappedCallback;
    const eventName = `context:${contextKey}`;
    // Notify extension of first subscription
    if (!__classPrivateFieldGet(this, _SDKClient_activeContextSubscriptions, "f").has(contextKey)) {
        __classPrivateFieldGet(this, _SDKClient_activeContextSubscriptions, "f").add(contextKey);
        __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_send).call(this, { type: 'subscribe:context', payload: { contextKey } });
        __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Subscribed to context', { contextKey });
    }
    __classPrivateFieldGet(this, _SDKClient_eventTarget, "f").addEventListener(eventName, wrappedCallback);
    return () => {
        __classPrivateFieldGet(this, _SDKClient_eventTarget, "f").removeEventListener(eventName, wrappedCallback);
        // Unsubscribe from extension
        if (__classPrivateFieldGet(this, _SDKClient_activeContextSubscriptions, "f").has(contextKey)) {
            __classPrivateFieldGet(this, _SDKClient_activeContextSubscriptions, "f").delete(contextKey);
            __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_send).call(this, { type: 'unsubscribe:context', payload: { contextKey } });
            __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Unsubscribed from context', { contextKey });
        }
    };
}, _SDKClient_getUpdatableEntities = function _SDKClient_getUpdatableEntities(callback) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    // Wrap callback to extract event data from CustomEvent
    const wrappedCallback = ((event) => {
        const customEvent = event;
        callback(customEvent.detail);
    });
    // Store wrapped callback on the original for cleanup
    callback.__wrappedListener = wrappedCallback;
    const eventName = 'updatableEntities:change';
    // Notify extension of first subscriber
    if (!__classPrivateFieldGet(this, _SDKClient_hasUpdatableSubscribers, "f")) {
        __classPrivateFieldSet(this, _SDKClient_hasUpdatableSubscribers, true, "f");
        __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_send).call(this, { type: 'subscribe:updatableEntities' });
        __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Started tracking updatable entities');
    }
    __classPrivateFieldGet(this, _SDKClient_eventTarget, "f").addEventListener(eventName, wrappedCallback);
    // Send current state immediately if available
    if (__classPrivateFieldGet(this, _SDKClient_currentUpdatableEntities, "f")) {
        callback(__classPrivateFieldGet(this, _SDKClient_currentUpdatableEntities, "f"));
    }
    return () => {
        __classPrivateFieldGet(this, _SDKClient_eventTarget, "f").removeEventListener(eventName, wrappedCallback);
        // Note: We can't easily track if this was the last listener
        // In practice, this is fine - the extension can handle multiple unsubscribes
        __classPrivateFieldSet(this, _SDKClient_hasUpdatableSubscribers, false, "f");
        __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_send).call(this, { type: 'unsubscribe:updatableEntities' });
        __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Stopped tracking updatable entities');
    };
}, _SDKClient_contextUpdate = 
/**
 * Update entity data (context - current component)
 * Used internally by ContextHandle.execute()
 * No permission check - handled by requestAttendedAutomation()
 */
async function _SDKClient_contextUpdate(entityType, data, options) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    const mode = options?.mode ?? 'override';
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Updating context', { entityType, mode });
    // Flatten nested data object before sending (consistent with API catalog operations)
    // SDK receives: { subjective: { chiefComplaintNotes: 'test' } }
    // Extension expects: { 'subjective.chiefComplaintNotes': 'test' }
    const flattenedData = __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_flattenObject).call(this, data);
    return __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_sendRequest).call(this, {
        type: 'contextUpdate',
        payload: { entityType, data: flattenedData, mode, componentId: options?.componentId }
    });
}, _SDKClient_updatePatient = 
/**
 * Update patient in current context
 * Checks if operation is disruptive and throws error if permission needed
 */
async function _SDKClient_updatePatient(data) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_validateContextOperation).call(this, 'updatePatient');
    return __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_contextUpdate).call(this, 'patient', data);
}, _SDKClient_updateEncounter = 
/**
 * Update encounter in current context
 * Checks if operation is disruptive and throws error if permission needed
 */
async function _SDKClient_updateEncounter(data) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_validateContextOperation).call(this, 'updateEncounter');
    return __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_contextUpdate).call(this, 'encounter', data);
}, _SDKClient_updateReferral = 
/**
 * Update referral in current context
 * Checks if operation is disruptive and throws error if permission needed
 */
async function _SDKClient_updateReferral(data) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_validateContextOperation).call(this, 'updateReferral');
    return __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_contextUpdate).call(this, 'referral', data);
}, _SDKClient_updateOrder = 
/**
 * Update order in current context
 * Checks if operation is disruptive and throws error if permission needed
 */
async function _SDKClient_updateOrder(data) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_validateContextOperation).call(this, 'updateOrder');
    return __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_contextUpdate).call(this, 'order', data);
}, _SDKClient_updateClaim = 
/**
 * Update claim in current context
 * Checks if operation is disruptive and throws error if permission needed
 */
async function _SDKClient_updateClaim(data) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_validateContextOperation).call(this, 'updateClaim');
    return __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_contextUpdate).call(this, 'claim', data);
}, _SDKClient_validateContextOperation = function _SDKClient_validateContextOperation(operationName) {
    const manifest = __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_getManifest).call(this);
    const contextCapabilities = manifest.capabilities?.context ?? manifest.capabilities?.workflow ?? {};
    const capability = contextCapabilities[operationName];
    if (!capability) {
        throw new SDKError(`Operation "${operationName}" is not available in manifest`, 'OPERATION_NOT_AVAILABLE', { operationName, availableOperations: Object.keys(contextCapabilities) });
    }
    if (!capability.available) {
        throw new SDKError(`Operation "${operationName}" is not available`, 'OPERATION_NOT_AVAILABLE', { operationName });
    }
    if (capability.disruptive) {
        throw new SDKError(`Operation "${operationName}" is disruptive and requires permission. Use requestAttendedAutomation() to request permission first.`, 'DISRUPTIVE_OPERATION', { operationName });
    }
}, _SDKClient_requestAttendedAutomation = 
// ============================================================================
// Context Automation (requestAttendedAutomation)
// ============================================================================
/**
 * Request attended automation for disruptive operations
 * Shows permission prompt and returns ContextHandle
 */
async function _SDKClient_requestAttendedAutomation(spec) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Requesting attended automation', { spec });
    // If no spec provided, return empty handle
    if (!spec || Object.keys(spec).length === 0) {
        return {};
    }
    const manifest = __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_getManifest).call(this);
    const contextCapabilities = manifest.capabilities?.context ?? manifest.capabilities?.workflow ?? {};
    // Build permission requests for each operation
    const permissionRequests = [];
    for (const [operationName, operationSpec] of Object.entries(spec)) {
        // Validate operation exists in manifest (context operations only)
        const capability = contextCapabilities[operationName];
        if (!capability?.available) {
            throw new SDKError(`Context operation "${operationName}" is not available in manifest`, 'OPERATION_NOT_AVAILABLE', { operationName, availableOperations: Object.keys(contextCapabilities) });
        }
        // Validate all requested fields are available
        // If wildcard '*', request all fields - no validation needed
        if (operationSpec.fields !== '*') {
            const unavailableFields = operationSpec.fields.filter(field => !capability.fields.includes(field));
            if (unavailableFields.length > 0) {
                throw new SDKError(`Fields not available for operation "${operationName}": ${unavailableFields.join(', ')}`, 'FIELDS_NOT_AVAILABLE', { operationName, unavailableFields, availableFields: capability.fields });
            }
        }
        permissionRequests.push({
            operation: operationName,
            entity: capability.entityType,
            fields: operationSpec.fields,
            isDisruptive: capability.disruptive
        });
    }
    // Request permissions (all-or-nothing)
    const grantedPermissions = new Map();
    for (const request of permissionRequests) {
        // Only request permission if operation is disruptive
        if (!request.isDisruptive) {
            __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Non-disruptive context operation, no permission needed', { operation: request.operation });
            grantedPermissions.set(request.operation, request.fields);
            continue;
        }
        // Check if we already have permission cached
        const hasPermission = SDKPermissionManager.checkCachedPermission(request.entity, request.fields, { type: 'context' });
        if (hasPermission) {
            __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Permission already granted (cached)', { operation: request.operation });
            grantedPermissions.set(request.operation, request.fields);
            continue;
        }
        // Request new permission
        const result = await SDKPermissionManager.requestPermission({
            entity: request.entity,
            fields: request.fields,
            context: { type: 'context' },
            capabilities: ['dom', 'network', 'navigation'], // Context operations may need all
            ttl: 'session'
        });
        if (!result.granted) {
            throw new SDKError(`Permission denied for operation "${request.operation}"`, 'PERMISSION_DENIED', { operation: request.operation, reason: result.reason });
        }
        grantedPermissions.set(request.operation, request.fields);
    }
    // Build ContextHandle with operation handles
    const handle = {};
    for (const [operationName, fields] of grantedPermissions.entries()) {
        const capability = contextCapabilities[operationName];
        handle[operationName] = new OperationHandle(operationName, capability.entityType, fields, capability.fields, capability.disruptive, false, // isAPIOperation = false for context operations
        __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_contextUpdate).bind(this));
    }
    return handle;
}, _SDKClient_hubSetActivationStatus = function _SDKClient_hubSetActivationStatus(status) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_send).call(this, { type: 'hub:setActivationStatus', payload: { status } });
}, _SDKClient_hubSetTooltipText = function _SDKClient_hubSetTooltipText(text) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_send).call(this, { type: 'hub:setTooltipText', payload: { text: text.slice(0, 50) } });
}, _SDKClient_hubNotificationBadgeSet = function _SDKClient_hubNotificationBadgeSet(count) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_send).call(this, { type: 'hub:notificationBadge:set', payload: { count } });
}, _SDKClient_hubNotificationBadgeHide = function _SDKClient_hubNotificationBadgeHide() {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_send).call(this, { type: 'hub:notificationBadge:hide' });
}, _SDKClient_hubPushNotificationShow = function _SDKClient_hubPushNotificationShow(details) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    // Extract and store callbacks (cannot be sent over postMessage)
    const callbacks = {};
    if (details.actionButtons?.leftButton?.callback !== undefined) {
        callbacks.left = details.actionButtons.leftButton.callback;
    }
    if (details.actionButtons?.rightButton?.callback !== undefined) {
        callbacks.right = details.actionButtons.rightButton.callback;
    }
    __classPrivateFieldGet(this, _SDKClient_pushNotificationCallbacks, "f").set(details.notificationId, callbacks);
    // Serialize buttons without callbacks
    const buttons = {};
    if (details.actionButtons?.leftButton !== undefined) {
        const { callback: _cb, ...rest } = details.actionButtons.leftButton;
        buttons.leftButton = rest;
    }
    if (details.actionButtons?.rightButton !== undefined) {
        const { callback: _cb, ...rest } = details.actionButtons.rightButton;
        buttons.rightButton = rest;
    }
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_send).call(this, {
        type: 'hub:pushNotification:show',
        payload: {
            text: details.text,
            notificationId: details.notificationId,
            timeoutInSec: details.timeoutInSec ?? 12,
            buttons: Object.keys(buttons).length > 0 ? buttons : undefined,
        },
    });
}, _SDKClient_hubPushNotificationHide = function _SDKClient_hubPushNotificationHide() {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_send).call(this, { type: 'hub:pushNotification:hide' });
}, _SDKClient_hubMicrophoneBadgeShow = function _SDKClient_hubMicrophoneBadgeShow() {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_send).call(this, { type: 'hub:microphoneBadge:show' });
}, _SDKClient_hubMicrophoneBadgeHide = function _SDKClient_hubMicrophoneBadgeHide() {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_send).call(this, { type: 'hub:microphoneBadge:hide' });
}, _SDKClient_hubCloseApp = function _SDKClient_hubCloseApp() {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_ensureConnected).call(this);
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_send).call(this, { type: 'hub:closeApp' });
}, _SDKClient_hubAppStateSubscribe = function _SDKClient_hubAppStateSubscribe(event, callback) {
    const wrappedCallback = ((e) => {
        const customEvent = e;
        callback(customEvent.detail);
    });
    callback.__hubWrappedListener = wrappedCallback;
    __classPrivateFieldGet(this, _SDKClient_hubEventTarget, "f").addEventListener('hub:appState', wrappedCallback);
    return () => {
        __classPrivateFieldGet(this, _SDKClient_hubEventTarget, "f").removeEventListener('hub:appState', wrappedCallback);
    };
}, _SDKClient_handleHubAppStateChange = function _SDKClient_handleHubAppStateChange(status) {
    __classPrivateFieldSet(this, _SDKClient_isAppOpen, status.isAppOpen, "f");
    __classPrivateFieldGet(this, _SDKClient_hubEventTarget, "f").dispatchEvent(new CustomEvent('hub:appState', { detail: status }));
}, _SDKClient_handlePushNotificationButtonClicked = function _SDKClient_handlePushNotificationButtonClicked(payload) {
    const { notificationId, buttonId } = payload;
    const callbacks = __classPrivateFieldGet(this, _SDKClient_pushNotificationCallbacks, "f").get(notificationId);
    if (callbacks !== undefined) {
        callbacks[buttonId]?.();
        __classPrivateFieldGet(this, _SDKClient_pushNotificationCallbacks, "f").delete(notificationId);
    }
}, _SDKClient_getManifest = function _SDKClient_getManifest() {
    if (!__classPrivateFieldGet(this, _SDKClient_manifest, "f")) {
        throw new SDKError('Manifest not available', 'MANIFEST_NOT_AVAILABLE');
    }
    return __classPrivateFieldGet(this, _SDKClient_manifest, "f");
}, _SDKClient_createAPI = function _SDKClient_createAPI() {
    const baseAPI = {
        ehr: {
            workflow: {
                on: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_workflowOn).bind(this),
                off: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_workflowOff).bind(this),
            },
            api: {
            // Catalog-based entity namespaces added below
            // e.g., vimSDK.ehr.api.patient.getDemographics()
            },
            context: {
                onChange: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_contextOnChange).bind(this),
                getUpdatableEntities: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_getUpdatableEntities).bind(this),
                requestAttendedAutomation: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_requestAttendedAutomation).bind(this),
                updatePatient: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_updatePatient).bind(this),
                updateEncounter: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_updateEncounter).bind(this),
                updateReferral: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_updateReferral).bind(this),
                updateOrder: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_updateOrder).bind(this),
                updateClaim: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_updateClaim).bind(this),
                update: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_contextUpdate).bind(this),
            },
            getManifest: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_getManifest).bind(this),
            waitUntilReady: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_waitUntilReady).bind(this),
        },
        hub: {
            setActivationStatus: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_hubSetActivationStatus).bind(this),
            setTooltipText: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_hubSetTooltipText).bind(this),
            notificationBadge: {
                set: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_hubNotificationBadgeSet).bind(this),
                hide: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_hubNotificationBadgeHide).bind(this),
            },
            pushNotification: {
                show: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_hubPushNotificationShow).bind(this),
                hide: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_hubPushNotificationHide).bind(this),
            },
            microphoneBadge: {
                show: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_hubMicrophoneBadgeShow).bind(this),
                hide: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_hubMicrophoneBadgeHide).bind(this),
            },
            closeApp: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_hubCloseApp).bind(this),
            appState: Object.defineProperty({ subscribe: __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_hubAppStateSubscribe).bind(this) }, 'isAppOpen', { get: () => __classPrivateFieldGet(this, _SDKClient_isAppOpen, "f"), enumerable: true }),
        },
    };
    // Add catalog-based entity namespaces under ehr.api (v3.0 - Catalog-based SDK)
    // e.g., vimSDK.ehr.api.patient.getDemographics()
    for (const [namespace, namespaceObj] of __classPrivateFieldGet(this, _SDKClient_entityNamespaces, "f").entries()) {
        baseAPI.ehr.api[namespace] = namespaceObj;
    }
    return baseAPI;
}, _SDKClient_handleMessage = function _SDKClient_handleMessage(event) {
    const message = event.data;
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Received message', { type: message.type });
    switch (message.type) {
        case 'workflow:event':
            __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_handleWorkflowEvent).call(this, message.payload);
            break;
        case 'context:change':
            __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_handleContextChange).call(this, message.payload);
            break;
        case 'updatableEntities:change':
            __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_handleUpdatableEntitiesChange).call(this, message.payload);
            break;
        case 'error':
            __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_handleError).call(this, message);
            break;
        case 'hub:appState:change':
            __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_handleHubAppStateChange).call(this, message.payload);
            break;
        case 'hub:pushNotification:buttonClicked':
            __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_handlePushNotificationButtonClicked).call(this, message.payload);
            break;
        default:
            __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Unknown message type', { message });
    }
}, _SDKClient_handleWorkflowEvent = function _SDKClient_handleWorkflowEvent(event) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Workflow event received', { type: event.type });
    // Dispatch event using EventTarget
    // Errors in callbacks are automatically isolated by the browser
    const eventName = `workflow:${event.type}`;
    __classPrivateFieldGet(this, _SDKClient_eventTarget, "f").dispatchEvent(new CustomEvent(eventName, { detail: event }));
}, _SDKClient_handleContextChange = function _SDKClient_handleContextChange(payload) {
    const { contextKey, previousData, currentData } = payload;
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Context change received', { contextKey });
    // Dispatch event using EventTarget
    const eventName = `context:${contextKey}`;
    __classPrivateFieldGet(this, _SDKClient_eventTarget, "f").dispatchEvent(new CustomEvent(eventName, {
        detail: { previousData, currentData }
    }));
}, _SDKClient_handleUpdatableEntitiesChange = function _SDKClient_handleUpdatableEntitiesChange(entities) {
    __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_log).call(this, 'Updatable entities changed', { entities });
    __classPrivateFieldSet(this, _SDKClient_currentUpdatableEntities, entities, "f");
    // Dispatch event using EventTarget
    const eventName = 'updatableEntities:change';
    __classPrivateFieldGet(this, _SDKClient_eventTarget, "f").dispatchEvent(new CustomEvent(eventName, { detail: entities }));
}, _SDKClient_handleError = function _SDKClient_handleError(message) {
    console.error('[Vim SDK] Error from extension:', message.payload);
}, _SDKClient_send = function _SDKClient_send(message, ports) {
    if (!__classPrivateFieldGet(this, _SDKClient_port, "f")) {
        throw new SDKError('SDK not connected', 'NOT_CONNECTED');
    }
    if (ports && ports.length > 0) {
        __classPrivateFieldGet(this, _SDKClient_port, "f").postMessage(message, ports);
    }
    else {
        __classPrivateFieldGet(this, _SDKClient_port, "f").postMessage(message);
    }
}, _SDKClient_sendRequest = function _SDKClient_sendRequest(request) {
    return new Promise((resolve, reject) => {
        // Create a new MessageChannel for this request
        const channel = new MessageChannel();
        const responsePort = channel.port1;
        const requestPort = channel.port2;
        // Set up timeout
        const timeout = setTimeout(() => {
            responsePort.close();
            requestPort.close();
            reject(new SDKError('Request timeout', 'TIMEOUT'));
        }, __classPrivateFieldGet(this, _SDKClient_options, "f").timeout);
        // Listen for response on port1
        responsePort.onmessage = (event) => {
            clearTimeout(timeout);
            responsePort.close();
            const response = event.data;
            resolve(response);
        };
        // Send request with port2 for response
        __classPrivateFieldGet(this, _SDKClient_instances, "m", _SDKClient_send).call(this, request, [requestPort]);
    });
}, _SDKClient_ensureConnected = function _SDKClient_ensureConnected() {
    if (__classPrivateFieldGet(this, _SDKClient_status, "f") !== 'connected') {
        throw new SDKError('SDK not connected. Make sure Vim Connect extension is installed.', 'NOT_CONNECTED');
    }
}, _SDKClient_log = function _SDKClient_log(message, data) {
    if (__classPrivateFieldGet(this, _SDKClient_options, "f").debug) {
        console.log(`[Vim SDK] ${message}`, data || '');
    }
};
_SDKClient_instance = { value: null };
// Export static methods as functions for convenience
const initVimSDK = SDKClient.init.bind(SDKClient);
const getVimSDK = SDKClient.get.bind(SDKClient);

console.log('~bye');
// Expose on window for script tag usage
if (typeof window !== 'undefined') {
    window.VimSDK = {
        init: initVimSDK,
        get: getVimSDK
    };
}

exports.SDKError = SDKError;
exports.getVimSDK = getVimSDK;
exports.initVimSDK = initVimSDK;
//# sourceMappingURL=index.js.map
