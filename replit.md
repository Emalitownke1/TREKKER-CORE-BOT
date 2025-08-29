# Overview

TREKKER-CORE-BOT is a multi-session WhatsApp bot management system built with Node.js. The project manages multiple WhatsApp bot instances within a single deployment, with each bot tied to a unique WhatsApp number. The system handles session validation, subscription checking, and automated bot lifecycle management using the Baileys WhatsApp library and MongoDB for persistent storage.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Core Components

**Session Management System**: The application uses a collection-based approach to manage WhatsApp sessions. All pending sessions are stored in MongoDB's `wasessions` collection, containing session IDs and authentication data. The system loops through available sessions to establish WhatsApp connections using the Baileys library.

**Subscription Validation**: A two-tier validation system ensures only authorized users can run bots. After establishing a valid connection, the system checks the `wavalidjid` collection to verify if the WhatsApp ID is authorized. Unauthorized users receive rejection messages and their sessions are removed to prevent reprocessing.

**Bot Lifecycle Management**: The system maintains a maximum of 15 concurrent bots using an in-memory Map for active bot tracking. Each bot goes through validation, subscription checking, and setup phases with appropriate user notifications at each stage.

**Database Architecture**: MongoDB serves as the primary data store with four main collections:
- `wasessions`: Stores pending WhatsApp session data
- `wavalidjid`: Contains authorized WhatsApp IDs for bot access
- `expiredjid`: Tracks expired or invalid session data
- `runningbots`: Maintains active bot instances

**Express.js API Layer**: Provides RESTful endpoints for bot management operations, though the specific routes are not fully visible in the current codebase. The server runs on configurable ports with JSON middleware for request handling.

**Authentication State Management**: Uses Baileys' multi-file authentication state system to persist WhatsApp session credentials across bot restarts and deployments.

## Design Patterns

**Database Abstraction**: The `DatabaseManager` class provides a clean interface for MongoDB operations, encapsulating connection management and common database queries.

**Event-Driven Architecture**: Leverages Baileys' event system for handling WhatsApp connection states, message events, and disconnection scenarios.

**Error Handling**: Implements comprehensive error handling for MongoDB connections, WhatsApp session failures, and bot lifecycle events using try-catch blocks and Boom error responses.

# External Dependencies

**WhatsApp Integration**: Uses `@whiskeysockets/baileys` library for WhatsApp Web API connectivity, enabling programmatic WhatsApp bot functionality without official API access.

**Database**: MongoDB serves as the primary database, configured via environment variables (`MONGO_URI` or `MONGODB_URI`) for flexible deployment across different environments.

**Logging**: Pino logger with pretty printing for structured, colorized console output during development and production monitoring.

**QR Code Generation**: `qrcode-terminal` package for displaying WhatsApp authentication QR codes in terminal environments.

**HTTP Framework**: Express.js for REST API endpoints and middleware management.

**Error Handling**: `@hapi/boom` for standardized HTTP error responses and error object creation.