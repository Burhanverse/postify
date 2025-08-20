# Middleware and Error Handling Enhancement

## Overview

This enhancement implements a comprehensive middleware and error handling system for the Postify bot to improve reliability, scalability, and user experience.

## 🛡️ Implemented Middleware

### 1. **Error Handler Middleware** (`src/middleware/errorHandler.ts`)
- **Purpose**: Catches and handles all types of errors gracefully
- **Features**:
  - Grammy API error handling with specific error codes
  - HTTP error handling
  - Bot configuration error handling
  - Unknown error fallback
  - User-friendly error messages
  - Comprehensive logging

### 2. **Rate Limiting Middleware** (`src/middleware/rateLimiter.ts`)
- **Purpose**: Prevents abuse and manages API rate limits
- **Features**:
  - Per-user rate limiting (10 requests per minute)
  - Automatic cleanup of expired entries
  - Action-specific tracking
  - Remaining time calculation
  - User feedback for rate limit violations

### 3. **Concurrency Control Middleware** (`src/middleware/concurrency.ts`)
- **Purpose**: Handles concurrent actions and prevents conflicts
- **Features**:
  - Resource-based locking (draft, channel, scheduling operations)
  - Automatic lock timeout (30 seconds)
  - Read-only operation bypass
  - User feedback for concurrent action attempts
  - Periodic cleanup of expired locks

### 4. **Validation Middleware** (`src/middleware/validation.ts`)
- **Purpose**: Validates and sanitizes user input
- **Features**:
  - Message length validation (4096 chars for text, 1024 for captions)
  - Command format validation
  - Media file size and duration validation (20MB, 10 minutes)
  - Suspicious content detection
  - URL validation for buttons
  - Post data validation utility

### 5. **Logging Middleware** (`src/middleware/logging.ts`)
- **Purpose**: Provides comprehensive request/response logging
- **Features**:
  - Request timing
  - Update type detection
  - Action identification
  - User activity tracking
  - System event logging
  - Performance monitoring

### 6. **Session Cleanup Middleware** (`src/middleware/sessionCleanup.ts`)
- **Purpose**: Prevents memory leaks and maintains clean sessions
- **Features**:
  - Orphaned state cleanup
  - Temporary key removal
  - Draft session management
  - Channel session management
  - Session activity tracking

### 7. **Enhanced Auth Middleware** (`src/middleware/auth.ts`)
- **Purpose**: Provides role-based access control
- **Features**:
  - Channel access validation
  - Selected channel requirement
  - Admin role checking
  - Post permission validation
  - Bot permission validation

## 🔧 Utility Functions

### Command Helpers (`src/utils/commandHelpers.ts`)
- **safeCommandExecution**: Wraps operations with error handling
- **safeDraftOperation**: Specialized draft operation wrapper with validation
- **wrapCommand**: Command handler wrapper
- **wrapCallbackHandler**: Callback handler wrapper
- **validateChannelAccess**: Channel access validation utility

### Command Builder (`src/utils/commandBuilder.ts`)
- **createProtectedCommand**: Creates commands with built-in error handling
- **createProtectedCallback**: Creates callbacks with built-in error handling
- **registerCommands**: Bulk command registration utility

## 🚀 Integration

### Middleware Stack Order
```typescript
bot.use(loggingMiddleware);        // Log all requests
bot.use(errorHandlerMiddleware);   // Catch and handle all errors
bot.use(validationMiddleware);     // Validate input
bot.use(rateLimitMiddleware);      // Rate limiting
bot.use(concurrencyMiddleware);    // Concurrency control
bot.use(session({ initial }));    // Session management
bot.use(userMiddleware);           // User management
bot.use(sessionCleanupMiddleware); // Session cleanup
```

### Protected Commands Example
```typescript
bot.command("schedule", 
  requireSelectedChannel(), 
  requirePostPermission(), 
  wrapCommand(async (ctx) => {
    // Command logic with automatic error handling
  }, "schedule")
);
```

## 📊 Benefits

### 1. **Error Resilience**
- Graceful error handling prevents bot crashes
- User-friendly error messages improve UX
- Comprehensive logging aids debugging

### 2. **Performance & Scalability**
- Rate limiting prevents API abuse
- Concurrency control prevents conflicts
- Session cleanup prevents memory leaks

### 3. **Security & Validation**
- Input validation prevents malicious content
- Role-based access control ensures proper permissions
- Channel validation prevents unauthorized access

### 4. **Observability**
- Detailed logging for monitoring and debugging
- Performance metrics tracking
- User activity monitoring

### 5. **Code Quality**
- Modular middleware architecture
- Consistent error handling patterns
- Type-safe implementations

## 🔍 Error Handling Patterns

### API Errors
- **400 Bad Request**: Specific handling for common issues (message not found, chat not found)
- **403 Forbidden**: Permission and blocking detection
- **429 Rate Limited**: Automatic retry guidance
- **5xx Server Errors**: Service unavailability handling

### Application Errors
- **Validation Errors**: Input format and content validation
- **Business Logic Errors**: Operation-specific error handling
- **Database Errors**: Connection and query error handling
- **Unknown Errors**: Fallback error handling

## 📈 Monitoring

### Logged Metrics
- Request/response times
- Error rates by type
- User activity patterns
- Rate limit violations
- Concurrency conflicts
- Session cleanup statistics

### Health Indicators
- Bot response times
- Error frequency
- User engagement patterns
- System resource usage

## 🛠️ Configuration

All middleware components are configurable:
- Rate limits (requests per window)
- Concurrency timeouts
- Validation thresholds
- Logging levels
- Cleanup intervals

## 🎯 Future Enhancements

1. **Metrics Dashboard**: Real-time monitoring interface
2. **Advanced Rate Limiting**: Dynamic limits based on user behavior
3. **Circuit Breaker**: Automatic service protection
4. **Caching Layer**: Response caching for frequently accessed data
5. **Health Checks**: Automated system health monitoring

This middleware system provides a robust foundation for scaling the bot while maintaining reliability and user experience.
