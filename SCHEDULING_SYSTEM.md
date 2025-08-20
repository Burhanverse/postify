# Enhanced Scheduling System

This document describes the improved and refactored scheduling functionality for the Postify bot.

## Overview

The scheduling system has been completely refactored to provide:
- **Reliable job execution** with comprehensive error handling
- **Modular architecture** with separation of concerns
- **Enhanced validation** for dates, times, and conflicts
- **Multi-channel support** with conflict detection
- **User-friendly interface** with multiple input formats
- **Comprehensive logging** and monitoring

## Architecture

### Core Components

1. **PostScheduler Service** (`src/services/scheduler.ts`)
   - Main scheduling logic and validation
   - Conflict detection and prevention
   - User permission management
   - Singleton pattern for consistency

2. **Enhanced Agenda Service** (`src/services/agenda.ts`)
   - Job queue management with improved error handling
   - Monitoring and statistics
   - Graceful shutdown support
   - Enhanced logging

3. **Scheduling Commands** (`src/commands/scheduling.ts`)
   - User interface for scheduling operations
   - Interactive scheduling options
   - Callback handling for buttons

4. **Updated Post Commands** (`src/commands/posts.ts`)
   - Integration with new scheduling system
   - Enhanced queue management
   - Improved user experience

## Features

### Time Input Formats

The system supports multiple time input formats for user convenience:

#### Relative Time
- `in 30m` or `in 30 minutes` - 30 minutes from now
- `in 2h` or `in 2 hours` - 2 hours from now  
- `in 1d` or `in 1 day` - 1 day from now

#### Absolute Time
- `14:30` - Today at 2:30 PM (or tomorrow if past)
- `2024-12-25 14:30` - Specific date and time
- `12/25/2024 14:30` - US date format
- `2024-12-25T14:30:00Z` - ISO format

### Validation and Limits

- **Minimum scheduling time**: 1 minute in the future
- **Maximum scheduling window**: 180 days (6 months)
- **Posts per channel per hour**: Maximum 10 posts
- **Minimum interval between posts**: 3 minutes
- **Timezone support**: UTC (with plans for user-specific timezones)

### Conflict Detection

The system automatically detects and prevents:
- Posts scheduled too close together (< 3 minutes)
- Exceeding hourly post limits per channel
- User permission violations
- Invalid channel access

### Interactive Scheduling

Users can schedule posts through:
- **Quick options**: Common time intervals (30m, 1h, 2h, etc.)
- **Custom input**: Flexible time format parsing
- **Conflict warnings**: Clear feedback with options to proceed
- **Schedule confirmation**: Review before final scheduling

## Usage Examples

### Basic Scheduling

```
/newpost
[Create your post content]
/schedule in 2h
```

### Advanced Scheduling

```
/newpost
[Create your post content]
/schedule 2024-12-25 09:00
```

### Interactive Scheduling

```
/newpost
[Create your post content]
/schedule
[Choose from interactive options]
```

### Queue Management

```
/queue                    # View scheduled posts
/queue stats             # View scheduling statistics
```

## Error Handling

### User-Facing Errors
- Clear, actionable error messages
- Format examples for invalid inputs
- Alternative suggestions when conflicts occur

### System-Level Errors
- Comprehensive logging with context
- Automatic job retry mechanisms
- Graceful degradation on failures
- Post status tracking and recovery

### Job Failure Recovery
- Posts reverted to draft status on failure
- Error metadata stored for debugging
- User notification of failed posts
- Manual retry options

## Monitoring and Statistics

### Available Metrics
- Total scheduled posts
- Failed job count
- Completed posts today
- Channel-specific statistics
- User activity tracking

### Logging Features
- Structured logging with correlation IDs
- Performance metrics
- Error tracking with stack traces
- User action audit trail

## Database Schema Updates

### Post Model Enhancements
- Enhanced status tracking
- Metadata field for error information
- Improved indexing for scheduling queries
- Timezone support fields

### Job Tracking
- Agenda job collection with enhanced metadata
- Job failure tracking and retry logic
- Performance monitoring data

## API Improvements

### PostScheduler Methods

```typescript
// Schedule a post with full validation
await postScheduler.schedulePost({
  postId: "...",
  scheduledAt: new Date(),
  timezone: "UTC",
  channelId: "...",
  userId: 123456
});

// Parse and validate user input
const result = postScheduler.parseScheduleInput("in 2h", "UTC");

// Check for conflicts
const conflicts = await postScheduler.checkSchedulingConflicts(
  channelId, 
  scheduledDateTime
);

// Get user's scheduled posts
const posts = await postScheduler.getScheduledPosts({
  userId: 123456,
  limit: 10
});
```

### Enhanced Agenda Functions

```typescript
// Get scheduling statistics
const stats = await getSchedulingStats();

// Cancel specific post jobs
await cancelPostJobs(postId);

// Graceful shutdown
await shutdownAgenda();
```

## Migration Notes

### Backward Compatibility
- Legacy `schedulePost` function maintained for compatibility
- Existing scheduled posts continue to work
- Gradual migration to new system

### Breaking Changes
- Enhanced validation may reject previously accepted formats
- Stricter conflict detection may prevent some schedules
- Improved error messages may affect automated systems

## Performance Optimizations

### Database Queries
- Indexed queries for scheduling lookups
- Efficient conflict detection algorithms
- Pagination for large post lists
- Optimized job queue processing

### Memory Management
- Singleton pattern for scheduler service
- Efficient job processing with concurrency limits
- Cleanup of completed jobs and sessions

### Network Efficiency
- Batch operations where possible
- Reduced API calls through intelligent caching
- Optimized message updates

## Future Enhancements

### Planned Features
- User-specific timezone settings
- Recurring post scheduling (weekly, monthly)
- Post template system
- Advanced scheduling rules (business hours only, etc.)
- Bulk scheduling operations
- Analytics dashboard

### Scalability Improvements
- Horizontal scaling support for job processing
- Redis-based job queue for better performance
- Microservice architecture considerations
- Load balancing for high-volume users

## Security Considerations

### Access Control
- Strict user permission validation
- Channel ownership verification
- Rate limiting for scheduling operations
- Input sanitization and validation

### Data Protection
- Secure job data handling
- Audit logging for compliance
- Error message sanitization
- Sensitive data encryption in transit

## Testing Strategy

### Unit Tests
- Input parsing validation
- Conflict detection logic
- Permission checking
- Error handling scenarios

### Integration Tests
- End-to-end scheduling workflows
- Database transaction integrity
- Job queue processing
- Multi-user scenarios

### Performance Tests
- High-volume scheduling scenarios
- Concurrent user operations
- Memory and CPU usage monitoring
- Database query optimization validation
