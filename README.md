# HCM Lite

**A Lightweight Human Capital Management System**

HCM Lite is a web-based Human Resource Management System designed to simplify employee management, attendance tracking, leave management, payroll processing, and other essential HR operations through a centralized platform.

The project is being developed using the MERN stack, with a focus on usability, secure authentication, reliable data management, and practical HR workflows.

---

## Project Overview

HCM Lite provides organizations with a centralized platform to manage their workforce and HR operations.

### Core Objectives

- Centralize employee information and HR operations.
- Simplify attendance and leave management.
- Streamline payroll processing.
- Provide role-based access control.
- Maintain reliable audit records.
- Support AI-assisted HR operations.
- Deliver a responsive and intuitive user experience.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React.js |
| Backend | Node.js |
| API Framework | Express.js |
| Database | MongoDB |
| ODM | Mongoose |
| Validation | Zod |
| Authentication | JWT |
| Styling | Existing project UI framework |
| Version Control | Git and GitHub |

*The implementation must follow the actual dependencies and conventions already present in the repository.*

---

## Main Modules

HCM Lite is organized around the following HR modules:

1. Dashboard
2. Employee Management
3. Department Management
4. Designation Management
5. Attendance Management
6. Leave Management
7. Holiday Management
8. Shift Management
9. Payroll Management
10. Salary Components
11. Recruitment
12. Performance Management
13. Training and Development
14. Document Management
15. Asset Management
16. Expense Management
17. Announcements
18. Notifications
19. Reports and Analytics
20. User and Role Management
21. Company Settings
22. Audit Logs
23. AI HR Assistant

The final implementation should follow the project's approved requirements and feature registry.

---

## Application Architecture

HCM Lite is designed as a **single-tenant application**.

One initialized application instance belongs to one company. The initial setup creates the company and its first administrator.

### Registration Flow

The public registration endpoint is:

`POST /api/v1/auth/register`

Registration performs the initial application setup:

1. Validate the submitted information using Zod.
2. Verify that the application has not already been initialized.
3. Create the company.
4. Create the first administrator.
5. Assign the administrator role on the server.
6. Initialize company settings.
7. Create an authenticated session.
8. Record the registration event in the audit log.
9. Return a successful response.

Registration must be atomic. If any critical operation fails, the incomplete setup must be rolled back.

### Registration Restrictions

- Registration is available only before the first company is created.
- Duplicate email addresses must be rejected.
- The administrator role must never be accepted directly from the client.
- Once initialized, registration returns HTTP `409 Conflict`.
- The response should direct visitors to `/login`.
- Existing company data must never be deleted or overwritten during registration.

### Landing Page and Routing

| Route | Access | Behaviour |
|---|---|---|
| `/` | Public / Authenticated | Landing page for anonymous visitors; dashboard for signed-in users |
| `/signup` | Public | Company registration screen |
| `/login` | Public | Login screen |
| `/employees` | Authenticated | Employee management |
| `/attendance` | Authenticated | Attendance management |
| `/payroll` | Authenticated | Payroll management |
| Other existing routes | Authenticated | Preserve existing routing behaviour |

Anonymous users attempting to access protected routes must continue to be redirected to `/login`.

Existing deep links must remain unchanged.

---

## Security Requirements

- Secure password hashing.
- Server-side role assignment.
- JWT-based authentication using the existing authentication architecture.
- Secure session cookie configuration.
- Input validation on the server.
- Duplicate-account protection.
- Authorization checks on protected operations.
- Audit logging for important actions.
- Environment variables for sensitive configuration.
- Never expose database credentials or JWT secrets in frontend code.

---

## Environment Configuration

Create a `.env` file in the backend directory.

Example:

```env
PORT=5000
NODE_ENV=development

MONGODB_URI=your_mongodb_connection_string

JWT_SECRET=your_secure_random_secret
JWT_EXPIRES_IN=1d

CLIENT_URL=http://localhost:5173
```

**Important:** Never commit `.env` files or production credentials to Git.

Use `.env.example` to document the required variables without exposing their values.

---

## Installation and Setup

### Prerequisites

Install the following:

- Node.js
- npm
- MongoDB Atlas account or local MongoDB
- Git

### 1. Clone the Repository

```bash
git clone YOUR_REPOSITORY_URL
cd HCM-Lite
```

Replace `YOUR_REPOSITORY_URL` with the actual repository URL.

### 2. Install Dependencies

Install frontend and backend dependencies according to the repository structure.

For example:

```bash
cd frontend
npm install
```

```bash
cd backend
npm install
```

### 3. Configure Environment Variables

Create the backend `.env` file and configure the MongoDB connection string and authentication secrets.

### 4. Start the Backend

```bash
cd backend
npm run dev
```

### 5. Start the Frontend

```bash
cd frontend
npm run dev
```

The actual commands should match the scripts defined in each `package.json`.

---

## Testing

Run the project's existing automated test suite before and after implementing changes.

Important verification scenarios include:

- Registration before initialization.
- Registration after initialization returns HTTP 409.
- Duplicate email rejection.
- Invalid input rejection.
- Server-assigned administrator role.
- Failed registration rollback.
- Successful session creation.
- Dashboard access after registration.
- Session persistence after browser refresh.
- Anonymous access redirection.
- Existing authenticated route behaviour.
- Existing regression tests.

The existing test suite must be preserved and updated only where required.

---

## Demo Verification

The project should support a local demonstration that proves the complete initial setup flow:

```text
Anonymous Visitor
       |
       v
    Home Page
       |
       v
    Sign Up
       |
       v
POST /api/v1/auth/register
       |
       v
Company + First Admin Created
       |
       v
Authenticated Session
       |
       v
    Dashboard
       |
       v
    Refresh Page
       |
       v
Session Still Valid
```

The deployed environment already contains a company. Therefore, its `/signup` endpoint is expected to return HTTP `409 Conflict`.

**Do not wipe or reset the live database to demonstrate registration.**

Verify the full registration flow against a local Atlas development database using `npm run demo` or the repository's equivalent demo command.

---

## Development Guidelines

All contributors and coding agents should follow these principles:

1. Inspect the existing repository before changing code.
2. Read the project documentation before implementation.
3. Preserve verified backend behaviour.
4. Avoid unnecessary architectural migrations.
5. Reuse existing components, services, and utilities.
6. Keep frontend and backend responsibilities separate.
7. Implement real functionality instead of decorative placeholders.
8. Ensure every visible button, link, and form works.
9. Validate all inputs on both frontend and backend.
10. Add regression tests for changed functionality.
11. Update documentation when implementation changes.
12. Never introduce destructive production database operations.

---

## Project Status

The project is being developed incrementally.

| Area | Status |
|---|---|
| Existing backend architecture | Established |
| Existing authentication | Established |
| Existing HR modules | Under development / verification |
| Public landing page | Planned for implementation |
| Signup interface | Planned for implementation |
| Registration integration | Uses existing setup endpoint |
| Local registration demonstration | Required |
| Production database reset | Not permitted |

Update this section as implementation milestones are completed.

---

## License

Add the appropriate license information before public distribution.

---

**HCM Lite — Simplifying Human Resource Management.**
