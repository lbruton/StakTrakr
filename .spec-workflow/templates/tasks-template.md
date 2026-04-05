# Tasks Document

## References

- **Issue:** PROJ-XXX
- **GitHub PR:** [#NNN](https://github.com/owner/repo/pull/NNN)
- **Spec Path:** `.spec-workflow/specs/{spec-name}/`

## UI Prototype Gate (conditional — include ONLY if design.md declares `Has UI Changes: Yes` AND `Prototype Required: Yes`)

> **BLOCKING:** Tasks 0.1–0.3 MUST be completed and approved before ANY task tagged `ui:true` begins.
> If the spec has no UI changes, delete this entire section.

- [ ] 0.1 Create visual mockup (Stitch or equivalent)
  - Invoke the `ui-mockup` skill (Step 1–4) OR the `frontend-design` skill
  - If design.md references a prototype HTML file, use it as the starting point
  - Generate mockups for all states: populated, loading, empty, error
  - Include light and dark theme variants
  - Purpose: Establish visual direction before writing any UI code
  - _Requirements: All UI-related requirements_
  - _Prompt: Role: UI/UX Designer | Task: Create visual mockups using the ui-mockup skill (Stitch) or frontend-design skill for all new/modified UI components described in design.md. Cover all visual states (populated, loading, empty, error) and theme variants (light, dark). If a reference HTML prototype exists at the path noted in design.md, use it as the baseline. | Restrictions: Do NOT write any production code. Output is mockup artifacts only. | Success: Stitch screen IDs or equivalent visual artifacts are generated and presented to the user for review._

- [ ] 0.2 Build interactive prototype (Playground)
  - Invoke the `playground` skill using the approved mockup as spec
  - Must use the project's actual tech stack (Bootstrap 5, CSS variables, data-theme attribute)
  - Include realistic sample data, interactive controls, and all data states
  - Purpose: Validate UX feel and interactions before production code
  - _Requirements: All UI-related requirements_
  - _Prompt: Role: Frontend Prototyper | Task: Build an interactive single-file HTML playground using the playground skill. Source visual design from the approved Stitch mockup (Task 0.1). Use the project's actual CSS framework and theme system. Include realistic data, clickable controls, hover states, and all data states (populated, loading, empty, error). | Restrictions: This is a throwaway prototype — do NOT integrate into the codebase. Must match the project's tech stack. | Success: User can interact with the prototype in a browser, validate layout/UX, and give explicit approval before implementation begins._

- [ ] 0.3 Visual approval checkpoint
  - Present prototype to user for explicit approval
  - Update design.md `Prototype Artifacts` section with Stitch IDs and playground file path
  - Purpose: Hard gate — no UI implementation proceeds without visual sign-off
  - _Requirements: All UI-related requirements_
  - _Prompt: Role: Project Coordinator | Task: Present the interactive prototype (Task 0.2) to the user. Ask explicitly - does this look and feel right? Collect approval or revision feedback. If approved, update the UI Impact Assessment section in design.md with the Stitch screen IDs and playground file path. | Restrictions: Do NOT proceed to any ui:true implementation task until the user explicitly approves the prototype. Verbal approval IS accepted for this visual checkpoint (unlike spec phase approvals). | Success: User has approved the visual design. design.md Prototype Artifacts section is populated. Implementation tasks may now begin._

---

- [ ] 1. Create core interfaces in src/types/feature.ts
  - File: src/types/feature.ts
  - Define TypeScript interfaces for feature data structures
  - Extend existing base interfaces from base.ts
  - Purpose: Establish type safety for feature implementation
  - _Leverage: src/types/base.ts_
  - _Requirements: 1.1_
  - _Prompt: Role: TypeScript Developer specializing in type systems and interfaces | Task: Create comprehensive TypeScript interfaces for the feature data structures following requirements 1.1, extending existing base interfaces from src/types/base.ts | Restrictions: Do not modify existing base interfaces, maintain backward compatibility, follow project naming conventions | Success: All interfaces compile without errors, proper inheritance from base types, full type coverage for feature requirements_

- [ ] 2. Create base model class in src/models/FeatureModel.ts
  - File: src/models/FeatureModel.ts
  - Implement base model extending BaseModel class
  - Add validation methods using existing validation utilities
  - Purpose: Provide data layer foundation for feature
  - _Leverage: src/models/BaseModel.ts, src/utils/validation.ts_
  - _Requirements: 2.1_
  - _Prompt: Role: Backend Developer with expertise in Node.js and data modeling | Task: Create a base model class extending BaseModel and implementing validation following requirement 2.1, leveraging existing patterns from src/models/BaseModel.ts and src/utils/validation.ts | Restrictions: Must follow existing model patterns, do not bypass validation utilities, maintain consistent error handling | Success: Model extends BaseModel correctly, validation methods implemented and tested, follows project architecture patterns_

- [ ] 3. Add specific model methods to FeatureModel.ts
  - File: src/models/FeatureModel.ts (continue from task 2)
  - Implement create, update, delete methods
  - Add relationship handling for foreign keys
  - Purpose: Complete model functionality for CRUD operations
  - _Leverage: src/models/BaseModel.ts_
  - _Requirements: 2.2, 2.3_
  - _Prompt: Role: Backend Developer with expertise in ORM and database operations | Task: Implement CRUD methods and relationship handling in FeatureModel.ts following requirements 2.2 and 2.3, extending patterns from src/models/BaseModel.ts | Restrictions: Must maintain transaction integrity, follow existing relationship patterns, do not duplicate base model functionality | Success: All CRUD operations work correctly, relationships are properly handled, database operations are atomic and efficient_

- [ ] 4. Create model unit tests in tests/models/FeatureModel.test.ts
  - File: tests/models/FeatureModel.test.ts
  - Write tests for model validation and CRUD methods
  - Use existing test utilities and fixtures
  - Purpose: Ensure model reliability and catch regressions
  - _Leverage: tests/helpers/testUtils.ts, tests/fixtures/data.ts_
  - _Requirements: 2.1, 2.2_
  - _Prompt: Role: QA Engineer with expertise in unit testing and Jest/Mocha frameworks | Task: Create comprehensive unit tests for FeatureModel validation and CRUD methods covering requirements 2.1 and 2.2, using existing test utilities from tests/helpers/testUtils.ts and fixtures from tests/fixtures/data.ts | Restrictions: Must test both success and failure scenarios, do not test external dependencies directly, maintain test isolation | Success: All model methods are tested with good coverage, edge cases covered, tests run independently and consistently_

- [ ] 5. Create service interface in src/services/IFeatureService.ts
  - File: src/services/IFeatureService.ts
  - Define service contract with method signatures
  - Extend base service interface patterns
  - Purpose: Establish service layer contract for dependency injection
  - _Leverage: src/services/IBaseService.ts_
  - _Requirements: 3.1_
  - _Prompt: Role: Software Architect specializing in service-oriented architecture and TypeScript interfaces | Task: Design service interface contract following requirement 3.1, extending base service patterns from src/services/IBaseService.ts for dependency injection | Restrictions: Must maintain interface segregation principle, do not expose internal implementation details, ensure contract compatibility with DI container | Success: Interface is well-defined with clear method signatures, extends base service appropriately, supports all required service operations_

- [ ] 6. Implement feature service in src/services/FeatureService.ts
  - File: src/services/FeatureService.ts
  - Create concrete service implementation using FeatureModel
  - Add error handling with existing error utilities
  - Purpose: Provide business logic layer for feature operations
  - _Leverage: src/services/BaseService.ts, src/utils/errorHandler.ts, src/models/FeatureModel.ts_
  - _Requirements: 3.2_
  - _Prompt: Role: Backend Developer with expertise in service layer architecture and business logic | Task: Implement concrete FeatureService following requirement 3.2, using FeatureModel and extending BaseService patterns with proper error handling from src/utils/errorHandler.ts | Restrictions: Must implement interface contract exactly, do not bypass model validation, maintain separation of concerns from data layer | Success: Service implements all interface methods correctly, robust error handling implemented, business logic is well-encapsulated and testable_

- [ ] 7. Add service dependency injection in src/utils/di.ts
  - File: src/utils/di.ts (modify existing)
  - Register FeatureService in dependency injection container
  - Configure service lifetime and dependencies
  - Purpose: Enable service injection throughout application
  - _Leverage: existing DI configuration in src/utils/di.ts_
  - _Requirements: 3.1_
  - _Prompt: Role: DevOps Engineer with expertise in dependency injection and IoC containers | Task: Register FeatureService in DI container following requirement 3.1, configuring appropriate lifetime and dependencies using existing patterns from src/utils/di.ts | Restrictions: Must follow existing DI container patterns, do not create circular dependencies, maintain service resolution efficiency | Success: FeatureService is properly registered and resolvable, dependencies are correctly configured, service lifetime is appropriate for use case_

- [ ] 8. Create service unit tests in tests/services/FeatureService.test.ts
  - File: tests/services/FeatureService.test.ts
  - Write tests for service methods with mocked dependencies
  - Test error handling scenarios
  - Purpose: Ensure service reliability and proper error handling
  - _Leverage: tests/helpers/testUtils.ts, tests/mocks/modelMocks.ts_
  - _Requirements: 3.2, 3.3_
  - _Prompt: Role: QA Engineer with expertise in service testing and mocking frameworks | Task: Create comprehensive unit tests for FeatureService methods covering requirements 3.2 and 3.3, using mocked dependencies from tests/mocks/modelMocks.ts and test utilities | Restrictions: Must mock all external dependencies, test business logic in isolation, do not test framework code | Success: All service methods tested with proper mocking, error scenarios covered, tests verify business logic correctness and error handling_

- [ ] 4. Create API endpoints
  - Design API structure
  - _Leverage: src/api/baseApi.ts, src/utils/apiUtils.ts_
  - _Requirements: 4.0_
  - _Prompt: Role: API Architect specializing in RESTful design and Express.js | Task: Design comprehensive API structure following requirement 4.0, leveraging existing patterns from src/api/baseApi.ts and utilities from src/utils/apiUtils.ts | Restrictions: Must follow REST conventions, maintain API versioning compatibility, do not expose internal data structures directly | Success: API structure is well-designed and documented, follows existing patterns, supports all required operations with proper HTTP methods and status codes_

- [ ] 4.1 Set up routing and middleware
  - Configure application routes
  - Add authentication middleware
  - Set up error handling middleware
  - _Leverage: src/middleware/auth.ts, src/middleware/errorHandler.ts_
  - _Requirements: 4.1_
  - _Prompt: Role: Backend Developer with expertise in Express.js middleware and routing | Task: Configure application routes and middleware following requirement 4.1, integrating authentication from src/middleware/auth.ts and error handling from src/middleware/errorHandler.ts | Restrictions: Must maintain middleware order, do not bypass security middleware, ensure proper error propagation | Success: Routes are properly configured with correct middleware chain, authentication works correctly, errors are handled gracefully throughout the request lifecycle_

- [ ] 4.2 Implement CRUD endpoints
  - Create API endpoints
  - Add request validation
  - Write API integration tests
  - _Leverage: src/controllers/BaseController.ts, src/utils/validation.ts_
  - _Requirements: 4.2, 4.3_
  - _Prompt: Role: Full-stack Developer with expertise in API development and validation | Task: Implement CRUD endpoints following requirements 4.2 and 4.3, extending BaseController patterns and using validation utilities from src/utils/validation.ts | Restrictions: Must validate all inputs, follow existing controller patterns, ensure proper HTTP status codes and responses | Success: All CRUD operations work correctly, request validation prevents invalid data, integration tests pass and cover all endpoints_

- [ ] 5. Add frontend components
  - Plan component architecture
  - _Leverage: src/components/BaseComponent.tsx, src/styles/theme.ts_
  - _Requirements: 5.0_
  - _Prompt: Role: Frontend Architect with expertise in React component design and architecture | Task: Plan comprehensive component architecture following requirement 5.0, leveraging base patterns from src/components/BaseComponent.tsx and theme system from src/styles/theme.ts | Restrictions: Must follow existing component patterns, maintain design system consistency, ensure component reusability | Success: Architecture is well-planned and documented, components are properly organized, follows existing patterns and theme system_

- [ ] 5.1 Create base UI components
  - Set up component structure
  - Implement reusable components
  - Add styling and theming
  - _Leverage: src/components/BaseComponent.tsx, src/styles/theme.ts_
  - _Requirements: 5.1_
  - _Prompt: Role: Frontend Developer specializing in React and component architecture | Task: Create reusable UI components following requirement 5.1, extending BaseComponent patterns and using existing theme system from src/styles/theme.ts | Restrictions: Must use existing theme variables, follow component composition patterns, ensure accessibility compliance | Success: Components are reusable and properly themed, follow existing architecture, accessible and responsive_

- [ ] 5.2 Implement feature-specific components
  - Create feature components
  - Add state management
  - Connect to API endpoints
  - _Leverage: src/hooks/useApi.ts, src/components/BaseComponent.tsx_
  - _Requirements: 5.2, 5.3_
  - _Prompt: Role: React Developer with expertise in state management and API integration | Task: Implement feature-specific components following requirements 5.2 and 5.3, using API hooks from src/hooks/useApi.ts and extending BaseComponent patterns | Restrictions: Must use existing state management patterns, handle loading and error states properly, maintain component performance | Success: Components are fully functional with proper state management, API integration works smoothly, user experience is responsive and intuitive_

## Standard Closing Tasks

- [ ] 6. Run project test suite and verify baseline
  - Run the project's test command to establish a passing baseline before changes
  - If no test suite exists, flag this and discuss with the user
  - _Leverage: Project test configuration (package.json scripts, vitest.config, jest.config, etc.)_
  - _Requirements: All_
  - _Prompt: Role: QA Engineer | Task: Run the project's established test suite to verify a passing baseline before implementation. Identify the test command from package.json, CLAUDE.md, or project conventions. If no test suite exists, flag this to the user. | Restrictions: Use the project's existing test framework, do not introduce a new one. | Success: Test suite runs and baseline results are recorded._

- [ ] 6.1 Write tests for new behavior (TDD — write BEFORE implementation)
  - Write failing tests using the project's test framework for all new behavior
  - Tests should cover the acceptance criteria from requirements.md
  - _Leverage: Project test framework, requirements.md acceptance criteria_
  - _Requirements: All_
  - _Prompt: Role: QA Engineer | Task: Write failing tests for all new behavior described in requirements.md using the project's test framework. Follow TDD - tests must fail before implementation, pass after. | Restrictions: Use the project's existing test framework. Tests must be runnable with the project's test command. | Success: Failing tests exist for all new acceptance criteria._

- [ ] 6.2 Verify all tests pass after implementation
  - Run the full test suite after all implementation tasks are complete
  - All new tests must pass; no existing tests may regress
  - _Leverage: Project test command_
  - _Requirements: All_
  - _Prompt: Role: QA Engineer | Task: Run the project's full test suite. Verify all new tests pass and no existing tests regressed. | Restrictions: Do not skip or disable failing tests. | Success: Full test suite passes with zero regressions._

- [ ] 6.3 Final integration and cleanup
  - Integrate all components
  - Verify no lint or type errors
  - Clean up temporary code and documentation
  - _Leverage: Project lint/build commands_
  - _Requirements: All_
  - _Prompt: Role: Senior Developer | Task: Complete final integration of all components and perform comprehensive cleanup. Run lint and type checks. Remove any temporary code or debug statements. | Restrictions: Must not break existing functionality. Ensure code quality standards are met. | Success: All components integrated, no lint or type errors, code is clean._
