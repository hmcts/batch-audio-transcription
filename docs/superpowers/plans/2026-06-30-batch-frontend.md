# Batch Audio Transcription Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Next.js 16 mock frontend to the `batch-audio-transcription` repo served at `/batch`, with full Vitest unit-test coverage and Playwright E2E tests.

**Architecture:** Frontend lives in `frontend/` at the repo root. `basePath: '/batch'` is set in next.config.ts so all routes are served under `/batch`. The updated root Dockerfile builds the frontend in a Node 24-alpine stage then copies the standalone output into the `python:3.12-slim` runner alongside the Python backend. Caddy (copied from `caddy:2.9`) routes `/batch/*` and `/_next/*` to Next.js on port 3001 and `/api/*` + `/health` to Python on port 8000. Supervisord manages all three processes. All data is static TypeScript fixtures — no live API calls.

**Tech Stack:** Next.js 16 + React 19, TypeScript strict, pnpm 10.33.0, Tailwind CSS 4, Radix UI (shadcn pattern), Biome 2.4.14, Vitest 4, Playwright 1.49, Docker multi-stage.

## Global Constraints

- All work in `frontend/` subdirectory unless touching Dockerfile/Caddyfile/supervisord.conf/entrypoint.sh/docker-compose.yml
- `pnpm@10.33.0` as package manager — never npm or yarn
- `@biomejs/biome@2.4.14` for lint/format — never ESLint/Prettier
- All shadcn components follow Radix primitive + CVA + `cn()` pattern
- No live API calls — all data from `frontend/lib/mock-data.ts`
- `basePath: '/batch'` — all Next.js `<Link href="...">` paths are relative to that base (Next.js prepends it automatically)
- TypeScript strict mode — no `any` without explicit comment
- Biome formatter: 2-space indent, 80-char line width, double quotes, LF line endings
- `output: 'standalone'` in next.config.ts

---

### Task 1: Scaffold `frontend/` directory with all config files

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/biome.json`
- Create: `frontend/next.config.ts`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/postcss.config.mjs`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/.gitignore`
- Create: `frontend/components.json`

**Interfaces:**
- Produces: working `pnpm install` + `pnpm run build` + `pnpm run dev` in `frontend/`

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "batch-audio-transcription-frontend",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@10.33.0+sha512.10568bb4a6afb58c9eb3630da90cc9516417abebd3fabbe6739f0ae795728da1491e9db5a544c76ad8eb7570f5c4bb3d6c637b2cb41bfdcdb47fa823c8649319",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "biome lint .",
    "lint:fix": "biome lint --write .",
    "format": "biome format --write .",
    "format:check": "biome format .",
    "type-check": "tsc --noEmit",
    "check": "biome check --write .",
    "test": "vitest",
    "test:unit": "vitest run tests/unit",
    "test:e2e": "playwright test",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "next": "~16.2.6",
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "@radix-ui/react-label": "^2.1.8",
    "@radix-ui/react-separator": "^1.1.8",
    "@radix-ui/react-slot": "^1.2.4",
    "autoprefixer": "^10.5.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.14.0",
    "next-themes": "^0.4.6",
    "react-dropzone": "^15.0.0",
    "react-h5-audio-player": "^3.10.2",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.5.0",
    "tailwindcss-animate": "^1.0.7"
  },
  "devDependencies": {
    "@biomejs/biome": "2.4.14",
    "@playwright/test": "^1.49.0",
    "@tailwindcss/postcss": "4.2.4",
    "@tailwindcss/typography": "^0.5.19",
    "@testing-library/react": "^16.3.2",
    "@types/node": "^25.6.2",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "@vitest/coverage-v8": "^4.1.4",
    "jsdom": "^29.1.1",
    "postcss": "^8.5.14",
    "tailwindcss": "4.2.4",
    "ts-node": "^10.9.2",
    "typescript": "^6.0.3",
    "vitest": "^4.1.4"
  }
}
```

- [ ] **Step 2: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "next.config.ts"
  ],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `frontend/biome.json`** (copy from `../courtstranscribe/frontend/biome.json` verbatim — it already exists in the repo)

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.14/schema.json",
  "assist": {
    "actions": {
      "source": { "organizeImports": "on" }
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "a11y": {
        "useKeyWithClickEvents": "off",
        "useValidAnchor": "warn",
        "useMediaCaption": "off",
        "useFocusableInteractive": "off",
        "noSvgWithoutTitle": "off",
        "useHtmlLang": "off",
        "useSemanticElements": "off",
        "useButtonType": "off",
        "noStaticElementInteractions": "off",
        "noNoninteractiveElementInteractions": "off",
        "noNoninteractiveElementToInteractiveRole": "off",
        "noNoninteractiveTabindex": "off",
        "useAriaPropsSupportedByRole": "off"
      },
      "complexity": {
        "noExtraBooleanCast": "error",
        "noAdjacentSpacesInRegex": "error",
        "noUselessCatch": "error",
        "noUselessConstructor": "error",
        "noUselessFragments": "error",
        "noUselessLabel": "error",
        "noUselessRename": "error",
        "noCommaOperator": "error",
        "noForEach": "off"
      },
      "correctness": {
        "noConstAssign": "error",
        "noConstantCondition": "error",
        "noEmptyPattern": "error",
        "noGlobalObjectCalls": "error",
        "noInvalidConstructorSuper": "error",
        "noInvalidBuiltinInstantiation": "error",
        "noNonoctalDecimalEscape": "error",
        "noPrecisionLoss": "error",
        "noSelfAssign": "error",
        "noSetterReturn": "error",
        "noUndeclaredVariables": "warn",
        "noUnreachable": "warn",
        "noUnreachableSuper": "error",
        "noUnsafeFinally": "error",
        "noUnsafeOptionalChaining": "error",
        "noUnusedLabels": "error",
        "noUnusedVariables": "warn",
        "useIsNan": "error",
        "useValidForDirection": "error",
        "useValidTypeof": "error",
        "useExhaustiveDependencies": "warn",
        "noChildrenProp": "warn",
        "noUnusedImports": "warn"
      },
      "style": {
        "useConst": "error",
        "useExponentiationOperator": "error",
        "useTemplate": "warn",
        "noNonNullAssertion": "warn"
      },
      "suspicious": {
        "noAsyncPromiseExecutor": "error",
        "noCatchAssign": "error",
        "noClassAssign": "error",
        "noCompareNegZero": "error",
        "noControlCharactersInRegex": "error",
        "noDebugger": "error",
        "noDoubleEquals": "warn",
        "noDuplicateCase": "error",
        "noDuplicateClassMembers": "error",
        "noDuplicateObjectKeys": "error",
        "noDuplicateParameters": "error",
        "noEmptyBlockStatements": "warn",
        "noExplicitAny": "off",
        "noFallthroughSwitchClause": "error",
        "noFunctionAssign": "error",
        "noGlobalAssign": "error",
        "noImportAssign": "error",
        "noLabelVar": "error",
        "noRedeclare": "error",
        "noShadowRestrictedNames": "warn",
        "noUnsafeNegation": "error",
        "noArrayIndexKey": "off",
        "noImplicitAnyLet": "off",
        "noAssignInExpressions": "off",
        "noVar": "error",
        "noWith": "error",
        "useIterableCallbackReturn": "off"
      },
      "performance": { "noImgElement": "warn" }
    }
  },
  "formatter": {
    "enabled": true,
    "formatWithErrors": false,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 80,
    "lineEnding": "lf",
    "includes": [
      "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.json",
      "!node_modules", "!.next", "!dist", "!build", "!coverage",
      "!public", "!*.config.js", "!*.config.ts"
    ]
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "jsxQuoteStyle": "double",
      "quoteProperties": "asNeeded",
      "trailingCommas": "es5",
      "semicolons": "always",
      "arrowParentheses": "always",
      "bracketSpacing": true,
      "bracketSameLine": false,
      "attributePosition": "auto"
    }
  },
  "json": {
    "formatter": { "enabled": true, "indentWidth": 2, "lineWidth": 80 }
  },
  "files": {
    "includes": [
      "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.json",
      "!node_modules", "!.next", "!dist", "!build", "!coverage",
      "!public", "!*.min.js", "!*.d.ts"
    ]
  }
}
```

- [ ] **Step 4: Create `frontend/next.config.ts`**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/batch",
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
```

- [ ] **Step 5: Create `frontend/tailwind.config.ts`** (copy verbatim from `../courtstranscribe/frontend/tailwind.config.ts`)

The file content is identical to courtstranscribe's. Copy it exactly as-is.

- [ ] **Step 6: Create `frontend/postcss.config.mjs`**

```javascript
/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    autoprefixer: {},
  },
};

export default config;
```

- [ ] **Step 7: Create `frontend/vitest.config.ts`**

```typescript
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "app/**/*.{ts,tsx}",
        "components/**/*.{ts,tsx}",
        "hooks/**/*.{ts,tsx}",
        "lib/**/*.{ts,tsx}",
      ],
      exclude: [
        "node_modules/",
        "tests/",
        "**/*.config.*",
        "**/*.d.ts",
        "**/*.test.*",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
```

- [ ] **Step 8: Create `frontend/.gitignore`**

```
# dependencies
/node_modules
/.pnp
.pnp.js

# testing
/coverage
/playwright-report
/test-results

# next.js
/.next/
/out/

# production
/build

# misc
.DS_Store
*.pem
.env*.local
npm-debug.log*
```

- [ ] **Step 9: Create `frontend/components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "app/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

- [ ] **Step 10: Install dependencies**

```bash
cd frontend && pnpm install
```

Expected: pnpm-lock.yaml generated, node_modules populated, no errors.

- [ ] **Step 11: Commit**

```bash
git checkout -b feat/batch-frontend
git add frontend/package.json frontend/tsconfig.json frontend/biome.json frontend/next.config.ts frontend/tailwind.config.ts frontend/postcss.config.mjs frontend/vitest.config.ts frontend/.gitignore frontend/components.json frontend/pnpm-lock.yaml
git commit -m "feat: scaffold batch frontend config and tooling"
```

---

### Task 2: Core framework files

**Files:**
- Create: `frontend/app/globals.css`
- Create: `frontend/app/layout.tsx`
- Create: `frontend/lib/utils.ts`
- Create: `frontend/tests/setup.ts`
- Create: `frontend/public/.gitkeep`

**Interfaces:**
- Produces: `app/layout.tsx` renders `children` with Tailwind CSS variables active

- [ ] **Step 1: Create `frontend/app/globals.css`** (copy verbatim from `../courtstranscribe/frontend/app/globals.css` — it already exists)

The file uses `@import "tailwindcss"`, `@config "../tailwind.config.ts"`, and defines all CSS custom properties (`--background`, `--foreground`, `--primary`, etc.) for both light and dark modes. Copy it exactly.

- [ ] **Step 2: Create `frontend/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Batch Audio Transcription",
  description: "Upload audio files and retrieve AI-generated transcripts",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Create `frontend/lib/utils.ts`**

```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default cn;
```

- [ ] **Step 4: Create `frontend/tests/setup.ts`**

```typescript
import { afterEach, beforeAll, vi } from "vitest";

beforeAll(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://localhost:8000";
});

afterEach(() => {
  vi.clearAllMocks();
});

global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
global.URL.revokeObjectURL = vi.fn();

if (typeof localStorage.clear !== "function") {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  });
}
```

- [ ] **Step 5: Create `frontend/public/.gitkeep`** (empty file to track the public directory)

- [ ] **Step 6: Verify build compiles**

```bash
cd frontend && pnpm run type-check
```

Expected: no TypeScript errors (may warn about missing pages — that is fine at this stage).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/ frontend/lib/utils.ts frontend/tests/setup.ts frontend/public/
git commit -m "feat: add core layout, globals CSS, and test setup"
```

---

### Task 3: Base UI components

**Files:**
- Create: `frontend/components/ui/button.tsx`
- Create: `frontend/components/ui/badge.tsx`
- Create: `frontend/components/ui/card.tsx`
- Create: `frontend/components/ui/progress.tsx`
- Create: `frontend/components/ui/separator.tsx`
- Create: `frontend/tests/unit/components/ui/button.test.tsx`
- Create: `frontend/tests/unit/components/ui/badge.test.tsx`
- Create: `frontend/tests/unit/components/ui/progress.test.tsx`

**Interfaces:**
- Consumes: `@/lib/utils` → `cn()`
- Produces: `Button`, `Badge`, `Card`/`CardHeader`/`CardContent`/`CardTitle`/`CardDescription`/`CardFooter`, `Progress`, `Separator`

- [ ] **Step 1: Create `frontend/components/ui/button.tsx`**

```tsx
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-foreground/10 hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
```

- [ ] **Step 2: Create `frontend/components/ui/badge.tsx`**

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        success:
          "border-transparent bg-green-100 text-green-800",
        warning:
          "border-transparent bg-yellow-100 text-yellow-800",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
```

- [ ] **Step 3: Create `frontend/components/ui/card.tsx`** (copy verbatim from courtstranscribe — `../courtstranscribe/frontend/components/ui/card.tsx`)

- [ ] **Step 4: Create `frontend/components/ui/progress.tsx`**

```tsx
import { cn } from "@/lib/utils";

interface ProgressProps {
  value?: number;
  className?: string;
}

function Progress({ value = 0, className }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-secondary",
        className
      )}
    >
      <div
        className="h-full bg-primary transition-all duration-300 ease-in-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export { Progress };
```

- [ ] **Step 5: Create `frontend/components/ui/separator.tsx`** (copy verbatim from courtstranscribe — `../courtstranscribe/frontend/components/ui/separator.tsx`)

- [ ] **Step 6: Write failing tests**

Create `frontend/tests/unit/components/ui/button.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeDefined();
  });

  it("calls onClick when clicked", async () => {
    const handler = vi.fn();
    render(<Button onClick={handler}>Click</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(handler).toHaveBeenCalledOnce();
  });

  it("is disabled when disabled prop is set", () => {
    render(<Button disabled>Disabled</Button>);
    expect(
      (screen.getByRole("button") as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("applies variant class", () => {
    render(<Button variant="destructive">Delete</Button>);
    expect(screen.getByRole("button").className).toContain("bg-destructive");
  });
});
```

Create `frontend/tests/unit/components/ui/badge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  it("renders text", () => {
    render(<Badge>COMPLETED</Badge>);
    expect(screen.getByText("COMPLETED")).toBeDefined();
  });

  it("applies success variant classes", () => {
    render(<Badge variant="success">Done</Badge>);
    expect(screen.getByText("Done").className).toContain("bg-green-100");
  });

  it("applies destructive variant classes", () => {
    render(<Badge variant="destructive">Failed</Badge>);
    expect(screen.getByText("Failed").className).toContain("bg-destructive");
  });
});
```

Create `frontend/tests/unit/components/ui/progress.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Progress } from "@/components/ui/progress";

describe("Progress", () => {
  it("renders with aria attributes", () => {
    const { container } = render(<Progress value={50} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).toBeDefined();
    expect(bar?.getAttribute("aria-valuenow")).toBe("50");
  });

  it("clamps value above 100 to 100", () => {
    const { container } = render(<Progress value={150} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("100");
  });

  it("clamps negative value to 0", () => {
    const { container } = render(<Progress value={-10} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("0");
  });

  it("fills inner div width proportionally", () => {
    const { container } = render(<Progress value={75} />);
    const inner = container.querySelector('[role="progressbar"] div');
    expect((inner as HTMLElement).style.width).toBe("75%");
  });
});
```

- [ ] **Step 7: Add `@testing-library/user-event` to devDependencies**

```bash
cd frontend && pnpm add -D @testing-library/user-event
```

- [ ] **Step 8: Run tests — expect FAIL (missing imports, empty components)**

```bash
cd frontend && pnpm run test:unit -- --reporter=verbose 2>&1 | head -40
```

- [ ] **Step 9: Run tests again — expect PASS after components are in place**

```bash
cd frontend && pnpm run test:unit
```

Expected: all 10 assertions pass, 0 failures.

- [ ] **Step 10: Commit**

```bash
git add frontend/components/ frontend/tests/unit/components/ui/
git commit -m "feat: add base UI components with unit tests"
```

---

### Task 4: Types and mock data

**Files:**
- Create: `frontend/lib/types.ts`
- Create: `frontend/lib/mock-data.ts`
- Create: `frontend/tests/unit/lib/mock-data.test.ts`

**Interfaces:**
- Produces: `TranscriptionJob`, `TranscriptSegment`, `TranscriptAccuracy`, `LowConfidenceSegment`, `JobStatus`
- Produces: `MOCK_JOBS: TranscriptionJob[]`, `getMockJobById(id): TranscriptionJob | undefined`

- [ ] **Step 1: Create `frontend/lib/types.ts`**

```typescript
export type JobStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

export interface TranscriptSegment {
  id: string;
  speaker: string;
  speakerColor: string;
  text: string;
  startTime: number;
  duration: number;
  confidence: number;
  flaggedForReview: boolean;
}

export interface LowConfidenceSegment {
  speaker: string;
  speakerColor: string;
  confidence: number;
  startTime: number;
}

export interface TranscriptAccuracy {
  wordErrorRate: number;
  wordsTranscribed: number;
  samplePercent: number;
  lowConfidenceCount: number;
  confidenceThreshold: number;
}

export interface TranscriptionJob {
  id: string;
  caseReference: string;
  tribunal: string;
  audioFileName: string;
  uploadedAt: string;
  completedAt?: string;
  status: JobStatus;
  progressPercent?: number;
  segments?: TranscriptSegment[];
  accuracy?: TranscriptAccuracy;
  lowConfidenceSegments?: LowConfidenceSegment[];
}
```

- [ ] **Step 2: Create `frontend/lib/mock-data.ts`**

```typescript
import type {
  LowConfidenceSegment,
  TranscriptAccuracy,
  TranscriptSegment,
  TranscriptionJob,
} from "./types";

const SEGMENT_COLORS: Record<string, string> = {
  Judge: "#6d28d9",
  Counsel: "#1d4ed8",
  Appellant: "#065f46",
  Respondent: "#92400e",
  Interpreter: "#9f1239",
};

function color(speaker: string): string {
  return SEGMENT_COLORS[speaker] ?? "#374151";
}

const JOB_1_SEGMENTS: TranscriptSegment[] = [
  {
    id: "s1",
    speaker: "Judge",
    speakerColor: color("Judge"),
    text: "Good morning. We are on the record. This is the appeal of the appellant, reference PA/05217/2025, before the First-tier Tribunal, Immigration and Asylum Chamber, sitting at Taylor House. I am Judge Marwood. Can I take the appearances, please.",
    startTime: 0,
    duration: 19,
    confidence: 0.98,
    flaggedForReview: false,
  },
  {
    id: "s2",
    speaker: "Counsel",
    speakerColor: color("Counsel"),
    text: "Good morning, Judge. My name is Adeyemi, of counsel, instructed by Whitfield Law. I appear on behalf of the appellant.",
    startTime: 19,
    duration: 11,
    confidence: 0.73,
    flaggedForReview: true,
  },
  {
    id: "s3",
    speaker: "Respondent",
    speakerColor: color("Respondent"),
    text: "Good morning, Judge. Clarke, I appear on behalf of the Secretary of State as respondent.",
    startTime: 30,
    duration: 9,
    confidence: 0.96,
    flaggedForReview: false,
  },
  {
    id: "s4",
    speaker: "Judge",
    speakerColor: color("Judge"),
    text: "Thank you. I understand we have a Tigrinya interpreter today. Could the interpreter confirm their full name and that they are able to interpret for the appellant in Tigrinya without any difficulty.",
    startTime: 39,
    duration: 14,
    confidence: 0.97,
    flaggedForReview: false,
  },
  {
    id: "s5",
    speaker: "Interpreter",
    speakerColor: color("Interpreter"),
    text: "Yes, Judge. My name is Helen Tesfay. I am interpreting in Tigrinya and the appellant and I understand one another without any difficulty.",
    startTime: 53,
    duration: 11,
    confidence: 0.96,
    flaggedForReview: false,
  },
  {
    id: "s6",
    speaker: "Appellant",
    speakerColor: color("Appellant"),
    text: "I confirm that I can understand the interpreter clearly.",
    startTime: 64,
    duration: 8,
    confidence: 0.78,
    flaggedForReview: true,
  },
];

const JOB_1_ACCURACY: TranscriptAccuracy = {
  wordErrorRate: 4.7,
  wordsTranscribed: 2284,
  samplePercent: 12,
  lowConfidenceCount: 6,
  confidenceThreshold: 85,
};

const JOB_1_LOW_CONFIDENCE: LowConfidenceSegment[] = [
  { speaker: "Counsel", speakerColor: color("Counsel"), confidence: 0.73, startTime: 19 },
  { speaker: "Appellant", speakerColor: color("Appellant"), confidence: 0.78, startTime: 159 },
  { speaker: "Appellant", speakerColor: color("Appellant"), confidence: 0.74, startTime: 178 },
  { speaker: "Appellant", speakerColor: color("Appellant"), confidence: 0.71, startTime: 220 },
  { speaker: "Respondent", speakerColor: color("Respondent"), confidence: 0.63, startTime: 239 },
  { speaker: "Appellant", speakerColor: color("Appellant"), confidence: 0.80, startTime: 264 },
];

const JOB_2_SEGMENTS: TranscriptSegment[] = [
  {
    id: "j2s1",
    speaker: "Judge",
    speakerColor: color("Judge"),
    text: "This is the resumed hearing in the matter of the appellant. The appellant is present and represented. Can we confirm the interpreter is also present.",
    startTime: 0,
    duration: 12,
    confidence: 0.99,
    flaggedForReview: false,
  },
  {
    id: "j2s2",
    speaker: "Counsel",
    speakerColor: color("Counsel"),
    text: "Yes, Judge. Counsel for the appellant, Ms. Okafor. The interpreter is present and ready.",
    startTime: 12,
    duration: 8,
    confidence: 0.97,
    flaggedForReview: false,
  },
];

const JOB_2_ACCURACY: TranscriptAccuracy = {
  wordErrorRate: 2.1,
  wordsTranscribed: 1456,
  samplePercent: 15,
  lowConfidenceCount: 1,
  confidenceThreshold: 85,
};

export const MOCK_JOBS: TranscriptionJob[] = [
  {
    id: "job-pa05217-2025",
    caseReference: "PA/05217/2025",
    tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
    audioFileName: "PA_05217_2025_hearing.mp3",
    uploadedAt: "2026-06-28T09:15:00Z",
    completedAt: "2026-06-28T09:47:00Z",
    status: "COMPLETED",
    segments: JOB_1_SEGMENTS,
    accuracy: JOB_1_ACCURACY,
    lowConfidenceSegments: JOB_1_LOW_CONFIDENCE,
  },
  {
    id: "job-ea11042-2025",
    caseReference: "EA/11042/2025",
    tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
    audioFileName: "EA_11042_2025_hearing.mp3",
    uploadedAt: "2026-06-27T14:30:00Z",
    completedAt: "2026-06-27T15:02:00Z",
    status: "COMPLETED",
    segments: JOB_2_SEGMENTS,
    accuracy: JOB_2_ACCURACY,
    lowConfidenceSegments: [
      { speaker: "Counsel", speakerColor: color("Counsel"), confidence: 0.81, startTime: 88 },
    ],
  },
  {
    id: "job-rp00331-2026",
    caseReference: "RP/00331/2026",
    tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
    audioFileName: "RP_00331_2026_hearing.mp3",
    uploadedAt: "2026-06-30T08:00:00Z",
    status: "FAILED",
  },
];

export function getMockJobById(
  id: string
): TranscriptionJob | undefined {
  return MOCK_JOBS.find((j) => j.id === id);
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function confidencePercent(confidence: number): number {
  return Math.round(confidence * 100);
}
```

- [ ] **Step 3: Write failing test**

Create `frontend/tests/unit/lib/mock-data.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  MOCK_JOBS,
  confidencePercent,
  formatTime,
  getMockJobById,
} from "@/lib/mock-data";

describe("MOCK_JOBS", () => {
  it("contains at least 3 jobs", () => {
    expect(MOCK_JOBS.length).toBeGreaterThanOrEqual(3);
  });

  it("all jobs have required fields", () => {
    for (const job of MOCK_JOBS) {
      expect(job.id).toBeTruthy();
      expect(job.caseReference).toBeTruthy();
      expect(job.status).toMatch(/^(PENDING|PROCESSING|COMPLETED|FAILED)$/);
    }
  });

  it("completed jobs have segments and accuracy", () => {
    const completed = MOCK_JOBS.filter((j) => j.status === "COMPLETED");
    expect(completed.length).toBeGreaterThan(0);
    for (const job of completed) {
      expect(job.segments?.length).toBeGreaterThan(0);
      expect(job.accuracy).toBeDefined();
    }
  });
});

describe("getMockJobById", () => {
  it("returns job when id matches", () => {
    const job = getMockJobById("job-pa05217-2025");
    expect(job?.caseReference).toBe("PA/05217/2025");
  });

  it("returns undefined for unknown id", () => {
    expect(getMockJobById("does-not-exist")).toBeUndefined();
  });
});

describe("formatTime", () => {
  it("formats 0 as 0:00", () => expect(formatTime(0)).toBe("0:00"));
  it("formats 65 as 1:05", () => expect(formatTime(65)).toBe("1:05"));
  it("formats 289 as 4:49", () => expect(formatTime(289)).toBe("4:49"));
});

describe("confidencePercent", () => {
  it("converts 0.98 to 98", () => expect(confidencePercent(0.98)).toBe(98));
  it("converts 0.73 to 73", () => expect(confidencePercent(0.73)).toBe(73));
});
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && pnpm run test:unit
```

Expected: 10 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/mock-data.ts frontend/tests/unit/lib/
git commit -m "feat: add TypeScript types and mock fixture data"
```

---

### Task 5: Feature components

**Files:**
- Create: `frontend/components/job-status/job-status-badge.tsx`
- Create: `frontend/components/transcript/transcript-segment.tsx`
- Create: `frontend/components/transcript/transcript-accuracy.tsx`
- Create: `frontend/components/transcript/needs-review-panel.tsx`
- Create: `frontend/components/transcript/audio-player-bar.tsx`
- Create: `frontend/components/jobs-table/jobs-table.tsx`
- Create: `frontend/components/audio-upload/audio-upload.tsx`
- Create: `frontend/tests/unit/components/job-status-badge.test.tsx`
- Create: `frontend/tests/unit/components/transcript-segment.test.tsx`
- Create: `frontend/tests/unit/components/jobs-table.test.tsx`

**Interfaces:**
- Consumes: `TranscriptionJob`, `TranscriptSegment`, `TranscriptAccuracy`, `LowConfidenceSegment` from `@/lib/types`
- Consumes: `formatTime`, `confidencePercent` from `@/lib/mock-data`
- Produces: `<JobStatusBadge status={JobStatus} />` — renders colored badge
- Produces: `<TranscriptSegment segment={TranscriptSegment} />` — renders one speaker turn
- Produces: `<TranscriptAccuracy accuracy={TranscriptAccuracy} />` — renders WER sidebar card
- Produces: `<NeedsReviewPanel items={LowConfidenceSegment[]} />` — renders low-confidence list
- Produces: `<AudioPlayerBar duration={number} />` — static audio player UI
- Produces: `<JobsTable jobs={TranscriptionJob[]} />` — table of all jobs
- Produces: `<AudioUpload onUpload={(file) => void} uploading={boolean} />` — file drop zone

- [ ] **Step 1: Create `frontend/components/job-status/job-status-badge.tsx`**

```tsx
import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "@/lib/types";

const STATUS_CONFIG: Record<
  JobStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" | "outline" }
> = {
  PENDING: { label: "Pending", variant: "secondary" },
  PROCESSING: { label: "Processing…", variant: "warning" },
  COMPLETED: { label: "Completed", variant: "success" },
  FAILED: { label: "Failed", variant: "destructive" },
};

interface JobStatusBadgeProps {
  status: JobStatus;
}

export function JobStatusBadge({ status }: JobStatusBadgeProps) {
  const { label, variant } = STATUS_CONFIG[status];
  return <Badge variant={variant}>{label}</Badge>;
}
```

- [ ] **Step 2: Create `frontend/components/transcript/transcript-segment.tsx`**

```tsx
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { confidencePercent, formatTime } from "@/lib/mock-data";
import type { TranscriptSegment as TranscriptSegmentType } from "@/lib/types";

interface TranscriptSegmentProps {
  segment: TranscriptSegmentType;
}

export function TranscriptSegment({ segment }: TranscriptSegmentProps) {
  const pct = confidencePercent(segment.confidence);
  const isLowConf = pct < 85;

  return (
    <div
      className={cn(
        "flex gap-4 py-4 border-b border-border last:border-b-0",
        segment.flaggedForReview && "bg-yellow-50"
      )}
    >
      {/* Timestamp */}
      <div className="w-14 shrink-0 text-right">
        <span className="text-xs font-mono text-primary hover:underline cursor-pointer">
          {formatTime(segment.startTime)}
        </span>
        <div className="text-xs text-muted-foreground">
          {segment.duration}s
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Speaker + confidence */}
        <div className="flex items-center gap-2 mb-1">
          <span
            className="inline-block w-3 h-3 rounded-sm shrink-0"
            style={{ backgroundColor: segment.speakerColor }}
          />
          <span className="font-semibold text-sm">{segment.speaker}</span>
          <span
            className={cn(
              "text-xs font-semibold px-1.5 py-0.5 rounded",
              isLowConf
                ? "bg-orange-100 text-orange-800"
                : "bg-muted text-muted-foreground"
            )}
          >
            {pct}% CONF
          </span>
        </div>

        {/* Text */}
        <p className="text-sm leading-relaxed">{segment.text}</p>

        {/* Flagged */}
        {segment.flaggedForReview && (
          <div className="flex items-center gap-1 mt-1 text-xs text-yellow-700">
            <AlertTriangle className="size-3" />
            Flagged for clerk review
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/components/transcript/transcript-accuracy.tsx`**

```tsx
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TranscriptAccuracy as TranscriptAccuracyType } from "@/lib/types";

interface TranscriptAccuracyProps {
  accuracy: TranscriptAccuracyType;
}

export function TranscriptAccuracy({ accuracy }: TranscriptAccuracyProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Transcript accuracy</CardTitle>
        <p className="text-xs text-muted-foreground">
          Auto-generated. Not yet reviewed by a clerk.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm text-muted-foreground">
              Word error rate (WER)
            </p>
            <p className="text-xs text-muted-foreground">
              Est. against {accuracy.samplePercent}% sampled
            </p>
          </div>
          <span className="text-2xl font-bold text-primary">
            {accuracy.wordErrorRate}%
          </span>
        </div>

        <div className="flex justify-between items-center border-t pt-3">
          <div>
            <p className="text-sm text-muted-foreground">Words transcribed</p>
            <p className="text-xs text-muted-foreground">
              {accuracy.lowConfidenceCount} segments below{" "}
              {accuracy.confidenceThreshold}%
            </p>
          </div>
          <span className="text-2xl font-bold">
            {accuracy.wordsTranscribed.toLocaleString()}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Create `frontend/components/transcript/needs-review-panel.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confidencePercent, formatTime } from "@/lib/mock-data";
import type { LowConfidenceSegment } from "@/lib/types";

interface NeedsReviewPanelProps {
  items: LowConfidenceSegment[];
  threshold?: number;
}

export function NeedsReviewPanel({
  items,
  threshold = 85,
}: NeedsReviewPanelProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Needs review</CardTitle>
        <p className="text-xs text-muted-foreground">
          {items.length} low-confidence or unresolved segments.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {items.map((item, i) => (
            <li
              key={`${item.speaker}-${item.startTime}-${i}`}
              className="flex items-center justify-between px-6 py-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: item.speakerColor }}
                />
                <span className="text-sm">{item.speaker}</span>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-sm font-semibold ${
                    confidencePercent(item.confidence) < threshold
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  {confidencePercent(item.confidence)}%
                </span>
                <span className="text-sm text-primary font-mono hover:underline cursor-pointer">
                  {formatTime(item.startTime)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Create `frontend/components/transcript/audio-player-bar.tsx`**

```tsx
"use client";

import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/mock-data";

interface AudioPlayerBarProps {
  duration: number;
}

export function AudioPlayerBar({ duration }: AudioPlayerBarProps) {
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);

  return (
    <div className="bg-white border-b border-border px-4 py-3 flex items-center gap-3">
      {/* Skip back */}
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-xs"
        onClick={() => setPosition((p) => Math.max(0, p - 10))}
        aria-label="Skip back 10 seconds"
      >
        <SkipBack className="size-4" />
        <span className="sr-only">−10s</span>
      </Button>

      {/* Play/pause */}
      <Button
        size="icon"
        className="size-10 rounded-full bg-primary"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? (
          <Pause className="size-4 fill-white text-white" />
        ) : (
          <Play className="size-4 fill-white text-white" />
        )}
      </Button>

      {/* Skip forward */}
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() => setPosition((p) => Math.min(duration, p + 10))}
        aria-label="Skip forward 10 seconds"
      >
        <SkipForward className="size-4" />
        <span className="sr-only">+10s</span>
      </Button>

      {/* Time */}
      <span className="text-sm font-mono text-muted-foreground w-10">
        {formatTime(position)}
      </span>

      {/* Waveform placeholder */}
      <div
        className="flex-1 h-8 rounded overflow-hidden bg-muted cursor-pointer relative"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          setPosition(Math.round(pct * duration));
        }}
        aria-label="Audio timeline"
      >
        <div
          className="absolute inset-y-0 left-0 bg-primary/20"
          style={{ width: `${(position / duration) * 100}%` }}
        />
        {/* Decorative waveform bars */}
        <div className="absolute inset-0 flex items-center gap-px px-1">
          {Array.from({ length: 80 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 rounded-full bg-primary/40"
              style={{
                height: `${20 + Math.sin(i * 0.4) * 15 + Math.cos(i * 0.7) * 10}%`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Total duration */}
      <span className="text-sm font-mono text-muted-foreground w-10 text-right">
        {formatTime(duration)}
      </span>

      {/* Speed selector */}
      <select
        className="text-sm border rounded px-1 py-0.5 bg-background"
        defaultValue="1"
        aria-label="Playback speed"
      >
        <option value="0.5">0.5×</option>
        <option value="1">1×</option>
        <option value="1.5">1.5×</option>
        <option value="2">2×</option>
      </select>
    </div>
  );
}
```

- [ ] **Step 6: Create `frontend/components/jobs-table/jobs-table.tsx`**

```tsx
import Link from "next/link";
import { FileAudio } from "lucide-react";
import { JobStatusBadge } from "@/components/job-status/job-status-badge";
import { Progress } from "@/components/ui/progress";
import type { TranscriptionJob } from "@/lib/types";

interface JobsTableProps {
  jobs: TranscriptionJob[];
}

export function JobsTable({ jobs }: JobsTableProps) {
  if (jobs.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">
        No transcription jobs yet. Upload an audio file to get started.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">
              Case reference
            </th>
            <th className="px-4 py-3 text-left font-semibold">File</th>
            <th className="px-4 py-3 text-left font-semibold">Uploaded</th>
            <th className="px-4 py-3 text-left font-semibold">Status</th>
            <th className="px-4 py-3 text-left font-semibold">Transcript</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {jobs.map((job) => (
            <tr key={job.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3 font-medium">{job.caseReference}</td>
              <td className="px-4 py-3 text-muted-foreground">
                <div className="flex items-center gap-2">
                  <FileAudio className="size-4 shrink-0" />
                  <span className="truncate max-w-48">
                    {job.audioFileName}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(job.uploadedAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-col gap-1">
                  <JobStatusBadge status={job.status} />
                  {job.status === "PROCESSING" &&
                    job.progressPercent !== undefined && (
                      <Progress value={job.progressPercent} className="w-24" />
                    )}
                </div>
              </td>
              <td className="px-4 py-3">
                {job.status === "COMPLETED" ? (
                  <Link
                    href={`/jobs/${job.id}`}
                    className="text-primary hover:underline font-medium"
                  >
                    View transcript →
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 7: Create `frontend/components/audio-upload/audio-upload.tsx`**

```tsx
"use client";

import { Upload } from "lucide-react";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AudioUploadProps {
  onUpload: (file: File) => void;
  uploading?: boolean;
}

const ACCEPTED_TYPES = {
  "audio/mpeg": [".mp3"],
  "audio/wav": [".wav"],
  "audio/mp4": [".mp4", ".m4a"],
  "audio/ogg": [".ogg"],
  "audio/flac": [".flac"],
};

export function AudioUpload({
  onUpload,
  uploading = false,
}: AudioUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) setSelectedFile(accepted[0]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxFiles: 1,
    disabled: uploading,
    onDropRejected: () =>
      toast.error("Unsupported file type. Please upload an audio file."),
  });

  const handleSubmit = () => {
    if (!selectedFile) {
      toast.error("Please select a file first.");
      return;
    }
    onUpload(selectedFile);
  };

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30",
          uploading && "opacity-50 cursor-not-allowed"
        )}
      >
        <input {...getInputProps()} aria-label="Audio file input" />
        <Upload className="mx-auto size-10 text-muted-foreground mb-3" />
        <p className="text-sm font-medium">
          {isDragActive
            ? "Drop the audio file here"
            : "Drag and drop an audio file, or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          MP3, WAV, MP4, M4A, OGG, FLAC supported
        </p>
        {selectedFile && (
          <p className="text-sm text-primary mt-3 font-medium">
            Selected: {selectedFile.name}
          </p>
        )}
      </div>

      <Button
        onClick={handleSubmit}
        disabled={!selectedFile || uploading}
        className="w-full"
      >
        {uploading ? "Uploading…" : "Upload for transcription"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 8: Write unit tests for JobStatusBadge**

Create `frontend/tests/unit/components/job-status-badge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JobStatusBadge } from "@/components/job-status/job-status-badge";

describe("JobStatusBadge", () => {
  it("renders COMPLETED with success label", () => {
    render(<JobStatusBadge status="COMPLETED" />);
    expect(screen.getByText("Completed")).toBeDefined();
  });

  it("renders PROCESSING with label", () => {
    render(<JobStatusBadge status="PROCESSING" />);
    expect(screen.getByText("Processing…")).toBeDefined();
  });

  it("renders FAILED with label", () => {
    render(<JobStatusBadge status="FAILED" />);
    expect(screen.getByText("Failed")).toBeDefined();
  });

  it("renders PENDING with label", () => {
    render(<JobStatusBadge status="PENDING" />);
    expect(screen.getByText("Pending")).toBeDefined();
  });
});
```

- [ ] **Step 9: Write unit tests for TranscriptSegment**

Create `frontend/tests/unit/components/transcript-segment.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TranscriptSegment } from "@/components/transcript/transcript-segment";
import type { TranscriptSegment as SegmentType } from "@/lib/types";

const SEGMENT: SegmentType = {
  id: "s1",
  speaker: "Judge",
  speakerColor: "#6d28d9",
  text: "Good morning. We are on the record.",
  startTime: 0,
  duration: 19,
  confidence: 0.98,
  flaggedForReview: false,
};

describe("TranscriptSegment", () => {
  it("renders speaker name", () => {
    render(<TranscriptSegment segment={SEGMENT} />);
    expect(screen.getByText("Judge")).toBeDefined();
  });

  it("renders transcript text", () => {
    render(<TranscriptSegment segment={SEGMENT} />);
    expect(
      screen.getByText("Good morning. We are on the record.")
    ).toBeDefined();
  });

  it("renders confidence percentage", () => {
    render(<TranscriptSegment segment={SEGMENT} />);
    expect(screen.getByText("98% CONF")).toBeDefined();
  });

  it("renders timestamp", () => {
    render(<TranscriptSegment segment={SEGMENT} />);
    expect(screen.getByText("0:00")).toBeDefined();
  });

  it("does not show flagged indicator when not flagged", () => {
    render(<TranscriptSegment segment={SEGMENT} />);
    expect(screen.queryByText(/flagged/i)).toBeNull();
  });

  it("shows flagged indicator when flaggedForReview is true", () => {
    render(
      <TranscriptSegment
        segment={{ ...SEGMENT, flaggedForReview: true }}
      />
    );
    expect(screen.getByText(/flagged for clerk review/i)).toBeDefined();
  });
});
```

- [ ] **Step 10: Write unit tests for JobsTable**

Create `frontend/tests/unit/components/jobs-table.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobsTable } from "@/components/jobs-table/jobs-table";
import { MOCK_JOBS } from "@/lib/mock-data";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

describe("JobsTable", () => {
  it("shows empty state message when no jobs", () => {
    render(<JobsTable jobs={[]} />);
    expect(screen.getByText(/no transcription jobs yet/i)).toBeDefined();
  });

  it("renders a row for each job", () => {
    render(<JobsTable jobs={MOCK_JOBS} />);
    for (const job of MOCK_JOBS) {
      expect(screen.getByText(job.caseReference)).toBeDefined();
    }
  });

  it("shows transcript link for COMPLETED jobs", () => {
    const completedJobs = MOCK_JOBS.filter((j) => j.status === "COMPLETED");
    render(<JobsTable jobs={completedJobs} />);
    expect(screen.getAllByText(/view transcript/i).length).toBe(
      completedJobs.length
    );
  });

  it("shows dash for non-completed jobs", () => {
    const failedJobs = MOCK_JOBS.filter((j) => j.status === "FAILED");
    render(<JobsTable jobs={failedJobs} />);
    expect(screen.getByText("—")).toBeDefined();
  });
});
```

- [ ] **Step 11: Run all unit tests**

```bash
cd frontend && pnpm run test:unit
```

Expected: all assertions pass.

- [ ] **Step 12: Commit**

```bash
git add frontend/components/ frontend/tests/unit/components/
git commit -m "feat: add feature components with unit tests"
```

---

### Task 6: Pages

**Files:**
- Create: `frontend/app/page.tsx` (dashboard — upload + jobs list)
- Create: `frontend/app/jobs/[jobId]/page.tsx` (transcript view)
- Create: `frontend/app/jobs/[jobId]/not-found.tsx`
- Create: `frontend/tests/unit/app/dashboard.test.tsx`
- Create: `frontend/tests/unit/app/transcript.test.tsx`

**Interfaces:**
- Consumes: all feature components, `MOCK_JOBS`, `getMockJobById`
- Produces: `/batch` renders dashboard; `/batch/jobs/:id` renders transcript or notFound()

- [ ] **Step 1: Create `frontend/app/page.tsx`**

```tsx
"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { AudioUpload } from "@/components/audio-upload/audio-upload";
import { JobsTable } from "@/components/jobs-table/jobs-table";
import { MOCK_JOBS } from "@/lib/mock-data";
import type { TranscriptionJob } from "@/lib/types";

function generateId(): string {
  return `job-${Math.random().toString(36).slice(2, 10)}`;
}

export default function DashboardPage() {
  const [jobs, setJobs] = useState<TranscriptionJob[]>(MOCK_JOBS);
  const [uploading, setUploading] = useState(false);

  const handleUpload = useCallback((file: File) => {
    setUploading(true);

    const newJobId = generateId();
    const newJob: TranscriptionJob = {
      id: newJobId,
      caseReference: file.name.replace(/\.[^.]+$/, "").replace(/_/g, "/"),
      tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
      audioFileName: file.name,
      uploadedAt: new Date().toISOString(),
      status: "PENDING",
      progressPercent: 0,
    };

    setJobs((prev) => [newJob, ...prev]);
    toast.success(`"${file.name}" submitted for transcription`);

    // Simulate PENDING → PROCESSING → COMPLETED
    setTimeout(() => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === newJobId ? { ...j, status: "PROCESSING", progressPercent: 10 } : j
        )
      );
      setUploading(false);
    }, 1000);

    // Simulate progress updates
    const intervals = [30, 55, 75, 90, 100];
    intervals.forEach((pct, i) => {
      setTimeout(
        () => {
          setJobs((prev) =>
            prev.map((j) =>
              j.id === newJobId
                ? { ...j, status: "PROCESSING", progressPercent: pct }
                : j
            )
          );
        },
        2000 + i * 1500
      );
    });

    // Complete after ~10s
    setTimeout(() => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === newJobId
            ? {
                ...j,
                status: "COMPLETED",
                progressPercent: 100,
                completedAt: new Date().toISOString(),
              }
            : j
        )
      );
      toast.success("Transcription complete!");
    }, 10000);
  }, []);

  const processingJobs = jobs.filter((j) => j.status === "PROCESSING");
  const completedJobs = jobs.filter((j) => j.status === "COMPLETED");
  const failedJobs = jobs.filter((j) => j.status === "FAILED");

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <h1 className="text-xl font-bold text-foreground">
            Batch Audio Transcription
          </h1>
          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
            Beta
          </span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-10">
        {/* Upload section */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Upload audio file</h2>
          <div className="max-w-xl">
            <AudioUpload onUpload={handleUpload} uploading={uploading} />
          </div>
        </section>

        {/* In-progress jobs */}
        {processingJobs.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-4">
              In progress ({processingJobs.length})
            </h2>
            <JobsTable jobs={processingJobs} />
          </section>
        )}

        {/* Recent transcripts */}
        <section>
          <h2 className="text-lg font-semibold mb-4">
            Recent transcripts
          </h2>
          <JobsTable jobs={completedJobs} />
        </section>

        {/* Failed jobs */}
        {failedJobs.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-4">
              Failed ({failedJobs.length})
            </h2>
            <JobsTable jobs={failedJobs} />
          </section>
        )}

        {/* All uploads */}
        <section>
          <h2 className="text-lg font-semibold mb-4">All uploads</h2>
          <JobsTable jobs={jobs} />
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Create `frontend/app/jobs/[jobId]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AudioPlayerBar } from "@/components/transcript/audio-player-bar";
import { NeedsReviewPanel } from "@/components/transcript/needs-review-panel";
import { TranscriptAccuracy } from "@/components/transcript/transcript-accuracy";
import { TranscriptSegment } from "@/components/transcript/transcript-segment";
import { getMockJobById } from "@/lib/mock-data";

interface PageProps {
  params: Promise<{ jobId: string }>;
}

export default async function TranscriptPage({ params }: PageProps) {
  const { jobId } = await params;
  const job = getMockJobById(jobId);

  if (!job || job.status !== "COMPLETED" || !job.segments || !job.accuracy) {
    notFound();
  }

  const totalDuration =
    job.segments.reduce(
      (max, s) => Math.max(max, s.startTime + s.duration),
      0
    );

  return (
    <main className="min-h-screen bg-background">
      {/* Audio player */}
      <AudioPlayerBar duration={totalDuration} />

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-4"
        >
          <ChevronLeft className="size-4" />
          Back to hearing list
        </Link>

        {/* Heading */}
        <p className="text-sm text-primary mb-1">{job.tribunal}</p>
        <h1 className="text-3xl font-bold mb-6">{job.caseReference}</h1>

        {/* Two-column layout */}
        <div className="flex gap-6 items-start">
          {/* Transcript (left) */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Transcript</h2>
              <p className="text-sm text-muted-foreground">
                Click a timestamp to jump the audio ·{" "}
                {job.segments.length} segments
              </p>
            </div>
            <div className="border border-border rounded-lg divide-y divide-border">
              {job.segments.map((segment) => (
                <TranscriptSegment key={segment.id} segment={segment} />
              ))}
            </div>
          </div>

          {/* Sidebar (right) */}
          <aside className="w-72 shrink-0 space-y-4">
            <TranscriptAccuracy accuracy={job.accuracy} />
            {job.lowConfidenceSegments &&
              job.lowConfidenceSegments.length > 0 && (
                <NeedsReviewPanel
                  items={job.lowConfidenceSegments}
                  threshold={job.accuracy.confidenceThreshold}
                />
              )}
          </aside>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Create `frontend/app/jobs/[jobId]/not-found.tsx`**

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">Transcript not found</h1>
      <p className="text-muted-foreground">
        This job may still be processing or does not exist.
      </p>
      <Button asChild>
        <Link href="/">Back to dashboard</Link>
      </Button>
    </main>
  );
}
```

- [ ] **Step 4: Write unit tests for the dashboard page**

Create `frontend/tests/unit/app/dashboard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/page";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

describe("DashboardPage", () => {
  it("renders page heading", () => {
    render(<DashboardPage />);
    expect(screen.getByText("Batch Audio Transcription")).toBeDefined();
  });

  it("renders upload section", () => {
    render(<DashboardPage />);
    expect(
      screen.getByText(/drag and drop an audio file/i)
    ).toBeDefined();
  });

  it("renders recent transcripts section", () => {
    render(<DashboardPage />);
    expect(screen.getByText("Recent transcripts")).toBeDefined();
  });

  it("shows mock completed jobs", () => {
    render(<DashboardPage />);
    expect(screen.getByText("PA/05217/2025")).toBeDefined();
    expect(screen.getByText("EA/11042/2025")).toBeDefined();
  });
});
```

- [ ] **Step 5: Write unit tests for the transcript page**

Create `frontend/tests/unit/app/transcript.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TranscriptPage from "@/app/jobs/[jobId]/page";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

describe("TranscriptPage", () => {
  it("renders case reference for known job", async () => {
    render(
      await TranscriptPage({
        params: Promise.resolve({ jobId: "job-pa05217-2025" }),
      })
    );
    expect(screen.getByText("PA/05217/2025")).toBeDefined();
  });

  it("renders tribunal name", async () => {
    render(
      await TranscriptPage({
        params: Promise.resolve({ jobId: "job-pa05217-2025" }),
      })
    );
    expect(
      screen.getByText(
        "First-tier Tribunal — Immigration and Asylum Chamber"
      )
    ).toBeDefined();
  });

  it("renders transcript segments", async () => {
    render(
      await TranscriptPage({
        params: Promise.resolve({ jobId: "job-pa05217-2025" }),
      })
    );
    expect(screen.getByText("Judge")).toBeDefined();
  });

  it("calls notFound for unknown job id", async () => {
    await expect(
      TranscriptPage({ params: Promise.resolve({ jobId: "unknown" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
```

- [ ] **Step 6: Run all unit tests**

```bash
cd frontend && pnpm run test:unit
```

Expected: all assertions pass.

- [ ] **Step 7: Verify the app compiles and runs**

```bash
cd frontend && pnpm run build
```

Expected: build succeeds. If TypeScript errors, fix them. Common issues:
- Missing React import (add `import type React from "react"`)
- `any` type warnings — either fix or add `// biome-ignore lint/suspicious/noExplicitAny: <reason>`

- [ ] **Step 8: Start dev server and manually verify**

```bash
cd frontend && pnpm run dev
```

Open `http://localhost:3000/batch` — should show the dashboard with upload zone and jobs table.
Open `http://localhost:3000/batch/jobs/job-pa05217-2025` — should show full transcript view.

- [ ] **Step 9: Commit**

```bash
git add frontend/app/
git commit -m "feat: add dashboard and transcript pages"
```

---

### Task 7: Playwright E2E tests

**Files:**
- Create: `frontend/playwright.config.ts`
- Create: `frontend/tests/e2e/dashboard.spec.ts`
- Create: `frontend/tests/e2e/transcript.spec.ts`

**Interfaces:**
- Consumes: running app at `PLAYWRIGHT_BASE_URL` (default `http://localhost:3000`)
- Produces: E2E test suite that validates critical user journeys

- [ ] **Step 1: Create `frontend/playwright.config.ts`**

```typescript
import { defineConfig, devices } from "@playwright/test";

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
```

- [ ] **Step 2: Create `frontend/tests/e2e/dashboard.spec.ts`**

```typescript
import { expect, test } from "@playwright/test";

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/batch");
  });

  test("page title is correct", async ({ page }) => {
    await expect(page).toHaveTitle(/Batch Audio Transcription/);
  });

  test("shows upload section", async ({ page }) => {
    await expect(
      page.getByText(/drag and drop an audio file/i)
    ).toBeVisible();
  });

  test("upload button is initially disabled", async ({ page }) => {
    const btn = page.getByRole("button", {
      name: /upload for transcription/i,
    });
    await expect(btn).toBeDisabled();
  });

  test("shows pre-loaded mock jobs in recent transcripts", async ({
    page,
  }) => {
    await expect(page.getByText("PA/05217/2025")).toBeVisible();
    await expect(page.getByText("EA/11042/2025")).toBeVisible();
  });

  test("View transcript link navigates to transcript page", async ({
    page,
  }) => {
    const link = page.getByRole("link", { name: /view transcript/i }).first();
    await link.click();
    await expect(page).toHaveURL(/\/batch\/jobs\//);
  });

  test("upload a file and see it appear in the list", async ({ page }) => {
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByLabel("Audio file input").click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "test-hearing.mp3",
      mimeType: "audio/mpeg",
      buffer: Buffer.from("mock-audio"),
    });
    await expect(page.getByText("Selected: test-hearing.mp3")).toBeVisible();

    const submitBtn = page.getByRole("button", {
      name: /upload for transcription/i,
    });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Job appears in the list
    await expect(
      page.getByText("test-hearing.mp3")
    ).toBeVisible({ timeout: 3000 });
  });
});
```

- [ ] **Step 3: Create `frontend/tests/e2e/transcript.spec.ts`**

```typescript
import { expect, test } from "@playwright/test";

const JOB_ID = "job-pa05217-2025";

test.describe("Transcript page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/batch/jobs/${JOB_ID}`);
  });

  test("shows case reference as heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "PA/05217/2025" })
    ).toBeVisible();
  });

  test("shows tribunal name", async ({ page }) => {
    await expect(
      page.getByText(
        "First-tier Tribunal — Immigration and Asylum Chamber"
      )
    ).toBeVisible();
  });

  test("shows transcript segments", async ({ page }) => {
    await expect(page.getByText("Good morning. We are on the record")).toBeVisible();
  });

  test("shows accuracy sidebar", async ({ page }) => {
    await expect(page.getByText("Transcript accuracy")).toBeVisible();
    await expect(page.getByText("4.7%")).toBeVisible();
    await expect(page.getByText("2,284")).toBeVisible();
  });

  test("shows needs review panel", async ({ page }) => {
    await expect(page.getByText("Needs review")).toBeVisible();
  });

  test("back link returns to dashboard", async ({ page }) => {
    await page.getByRole("link", { name: /back to hearing list/i }).click();
    await expect(page).toHaveURL("/batch");
  });

  test("audio player controls are visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: /play/i })).toBeVisible();
  });

  test("unknown job id shows 404 page", async ({ page }) => {
    await page.goto("/batch/jobs/does-not-exist");
    await expect(page.getByText(/transcript not found/i)).toBeVisible();
  });
});
```

- [ ] **Step 4: Install Playwright browser**

```bash
cd frontend && pnpm exec playwright install --with-deps chromium
```

Expected: Chromium browser downloaded to local Playwright cache.

- [ ] **Step 5: Start dev server in background, run E2E tests**

```bash
# Terminal 1:
cd frontend && pnpm run dev &
sleep 5

# Terminal 2:
cd frontend && pnpm run test:e2e
```

Expected: all Playwright tests pass. If tests fail:
- Check that `pnpm run dev` is running on port 3000
- `next.config.ts` has `basePath: '/batch'` — so the base URL `/batch` must be accessible

- [ ] **Step 6: Fix any E2E failures, re-run until green**

- [ ] **Step 7: Kill dev server**

```bash
kill $(lsof -ti:3000)
```

- [ ] **Step 8: Commit**

```bash
git add frontend/playwright.config.ts frontend/tests/e2e/
git commit -m "feat: add Playwright E2E tests for dashboard and transcript"
```

---

### Task 8: Update root Dockerfile, Caddyfile, supervisord, and docker-compose

**Files:**
- Modify: `Dockerfile` (replace entirely)
- Create: `Caddyfile`
- Create: `supervisord.conf`
- Modify: `entrypoint.sh`
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces: `docker build` succeeds
- Produces: `docker-compose up` starts container serving `/batch` on port 3000 and `/api/*` on port 3000 (routed to Python on 8000 internally)

- [ ] **Step 1: Read current files before editing**

Read `Dockerfile`, `entrypoint.sh`, `docker-compose.yml` to understand current state.

- [ ] **Step 2: Replace `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7

# ── Stage 1: Frontend dependencies ──────────────────────────────────────────
FROM node:24-alpine AS frontend-deps
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-bat,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir=/pnpm-store

# ── Stage 2: Frontend build ──────────────────────────────────────────────────
FROM node:24-alpine AS frontend-builder
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app/frontend
COPY --from=frontend-deps /app/frontend/node_modules ./node_modules
COPY frontend/ .
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=cache,id=next-bat,target=/app/frontend/.next/cache \
    pnpm run build

# ── Stage 3: Combined runtime ────────────────────────────────────────────────
FROM python:3.12-slim AS runner

# Copy Caddy binary from official image (avoids curl + manual download)
COPY --from=caddy:2.9 /usr/bin/caddy /usr/bin/caddy

# Install Node 24, ffmpeg, supervisor
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl gnupg2 ffmpeg supervisor && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 appuser \
 && adduser --system --uid 1001 --ingroup appuser appuser

WORKDIR /app

# Python backend
COPY pyproject.toml .
COPY src/ src/
RUN pip install --no-cache-dir "."
COPY migrations/ migrations/
COPY alembic.ini .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# Next.js standalone output
WORKDIR /app/frontend
COPY --from=frontend-builder /app/frontend/.next/standalone ./
COPY --from=frontend-builder /app/frontend/.next/static ./.next/static
COPY --from=frontend-builder /app/frontend/public ./public
RUN chown -R appuser:appuser /app/frontend

# Proxy and process manager config
COPY Caddyfile /etc/caddy/Caddyfile
COPY supervisord.conf /etc/supervisord.conf

WORKDIR /app
RUN chown -R appuser:appuser /app

ENV PYTHONPATH=/app/src
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV NEXT_TELEMETRY_DISABLED=1

USER appuser

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
```

- [ ] **Step 3: Update `entrypoint.sh`**

```sh
#!/bin/sh
set -e

echo "Running database migrations..."
alembic upgrade head

echo "Starting services via supervisord..."
exec supervisord -c /etc/supervisord.conf
```

- [ ] **Step 4: Create `Caddyfile`**

```
{
	auto_https off
	admin off
}

:3000 {
	route {
		# Python API endpoints
		@python path /api/* /health /docs /openapi.json
		handle @python {
			reverse_proxy localhost:8000
		}

		# Next.js handles /batch/* and its asset paths
		handle {
			reverse_proxy localhost:3001
		}
	}
}
```

- [ ] **Step 5: Create `supervisord.conf`**

```ini
[supervisord]
nodaemon=true
pidfile=/tmp/supervisord.pid
logfile=/dev/null
logfile_maxbytes=0

[program:caddy]
command=caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
autostart=true
autorestart=false
environment=HOME="/tmp"
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:nextjs]
command=node server.js
directory=/app/frontend
autostart=true
autorestart=false
environment=PORT="3001",HOSTNAME="127.0.0.1",NODE_ENV="production"
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:python]
command=python -m transcription_svc.main
directory=/app
autostart=true
autorestart=false
environment=PYTHONPATH="/app/src",PYTHONUNBUFFERED="1"
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[eventlistener:quit_on_exit]
command=/bin/sh -c "printf 'READY\n'; IFS= read -r _; kill -TERM $PPID; printf 'RESULT 2\nOK'"
events=PROCESS_STATE_EXITED,PROCESS_STATE_FATAL
stdout_logfile=/dev/null
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
```

- [ ] **Step 6: Update `docker-compose.yml`** — add a `frontend-dev` service for local frontend-only dev

Read the current `docker-compose.yml` first, then add a new service that runs the Next.js dev server without needing the full multi-stage build:

```yaml
  frontend-dev:
    build:
      context: ./frontend
      dockerfile: Dockerfile.dev
    ports:
      - "3001:3001"
    volumes:
      - ./frontend:/app
      - /app/node_modules
    environment:
      - PORT=3001
    profiles:
      - frontend-dev
```

Also create `frontend/Dockerfile.dev`:

```dockerfile
FROM node:24-alpine
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV PORT=3001
CMD ["pnpm", "run", "dev", "--", "--port", "3001"]
```

- [ ] **Step 7: Build the Docker image to verify it compiles**

```bash
docker build -t bat-combined:test . 2>&1 | tail -20
```

Expected: Build succeeds with output `Successfully built <hash>` or `writing image sha256:...`.

If build fails:
- Python dependency errors → check `pyproject.toml`
- Node/pnpm errors → check `frontend/pnpm-lock.yaml` is committed
- Next.js build errors → run `cd frontend && pnpm run build` locally first

- [ ] **Step 8: Smoke-test the combined container**

```bash
# Start with minimal env (skip DB migration by setting DATABASE_CONNECTION_STRING to sqlite or stub)
docker run --rm -p 3000:3000 \
  -e DATABASE_CONNECTION_STRING=postgresql://skip:skip@localhost/skip \
  -e ENVIRONMENT=test \
  -e LOCAL_API_KEY=test \
  -e AZURE_SPEECH_KEY=test \
  -e AZURE_SPEECH_ENDPOINT=https://test.cognitiveservices.azure.com \
  -e AZURE_STORAGE_ACCOUNT_NAME=test \
  -e AZURE_STORAGE_CONTAINER_NAME=test \
  bat-combined:test &

sleep 10
curl -f http://localhost:3000/batch && echo "Frontend OK"
curl -f http://localhost:3000/health || echo "Python backend (expected error without DB)"
```

The frontend should return HTML. The Python backend will error without a real DB — that is expected.

- [ ] **Step 9: Kill test container**

```bash
docker ps -q --filter "ancestor=bat-combined:test" | xargs docker stop
```

- [ ] **Step 10: Commit**

```bash
git add Dockerfile Caddyfile supervisord.conf entrypoint.sh docker-compose.yml frontend/Dockerfile.dev
git commit -m "feat: update Dockerfile to serve frontend+backend via Caddy+supervisord"
```

---

### Task 9: Update GitHub Actions CI

**Files:**
- Modify: `.github/workflows/tests.yml`
- Modify: `.github/workflows/code-analysis.yml`
- Create: `.github/workflows/e2e-tests.yml`

**Interfaces:**
- Produces: frontend unit tests + type-check run on every PR
- Produces: Biome lint + format check runs on frontend on every PR
- Produces: Playwright E2E workflow that can be run manually or after deploy

- [ ] **Step 1: Read current `.github/workflows/tests.yml`**

Read the file to understand the current jobs, then ADD a new `frontend-tests` job without removing any existing jobs.

- [ ] **Step 2: Add `frontend-tests` job to `tests.yml`**

Add this job alongside the existing `unit-tests` job:

```yaml
  frontend-tests:
    name: Frontend — type-check + unit tests
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10.33.0

      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: "pnpm"
          cache-dependency-path: frontend/pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Type-check
        run: pnpm run type-check

      - name: Unit tests
        run: pnpm run test:unit -- --reporter=verbose
```

- [ ] **Step 3: Read current `.github/workflows/code-analysis.yml`**

Read to understand structure, then ADD a `frontend-analysis` job.

- [ ] **Step 4: Add `frontend-analysis` job to `code-analysis.yml`**

```yaml
  frontend-analysis:
    name: Frontend — Biome lint + format
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10.33.0

      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: "pnpm"
          cache-dependency-path: frontend/pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Biome check
        run: pnpm exec biome ci .
```

- [ ] **Step 5: Create `.github/workflows/e2e-tests.yml`**

```yaml
name: E2E Tests (Playwright)

on:
  workflow_dispatch:
    inputs:
      base_url:
        description: "Base URL to test against (default: built container)"
        required: false
        default: "http://localhost:3000"

jobs:
  e2e:
    name: Playwright E2E
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10.33.0

      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: "pnpm"
          cache-dependency-path: frontend/pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps chromium

      - name: Build Next.js app
        run: pnpm run build

      - name: Start Next.js server
        run: pnpm run start &
        env:
          PORT: 3000

      - name: Wait for server
        run: npx wait-on http://localhost:3000/batch --timeout 30000

      - name: Run Playwright tests
        run: pnpm run test:e2e
        env:
          PLAYWRIGHT_BASE_URL: ${{ github.event.inputs.base_url || 'http://localhost:3000' }}

      - name: Upload Playwright report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: frontend/playwright-report/
          retention-days: 7
```

- [ ] **Step 6: Add `wait-on` to frontend devDependencies**

```bash
cd frontend && pnpm add -D wait-on
```

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/ frontend/pnpm-lock.yaml
git commit -m "ci: add frontend unit tests, Biome analysis, and Playwright E2E workflow"
```

---

### Task 10: Open PR, fix CI, address Copilot comments, merge, verify in dev

**Interfaces:**
- Consumes: all previous tasks complete and committed on `feat/batch-frontend` branch
- Produces: merged PR, deployment to dev, Playwright green against dev URL

- [ ] **Step 1: Final local checks**

```bash
# From repo root:
cd frontend && pnpm run type-check && pnpm run test:unit && pnpm exec biome ci .
```

Expected: no errors.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feat/batch-frontend
```

- [ ] **Step 3: Open PR using GitHub CLI**

```bash
gh pr create \
  --title "feat: add batch audio transcription frontend" \
  --body "$(cat <<'EOF'
## Summary

- Adds Next.js 16 / React 19 frontend to `batch-audio-transcription` repo under `frontend/`
- Served at `/batch` base path (same DNS as courtstranscribe, different path — infrastructure routing TBD)
- Implements all 6 UI requirements: upload, progress, transcript link, audio quality indicator, previous transcripts list, previous uploads list
- All data is mock/static for this phase — no live API calls
- Full Vitest unit-test coverage; Playwright E2E tests for dashboard and transcript journeys

## Tech stack

Next.js 16 · React 19 · pnpm 10 · Tailwind CSS 4 · Radix UI · Biome 2 · Vitest 4 · Playwright 1.49 — exact match to courtstranscribe.

## Architecture decisions

1. **Standalone output + Caddy**: same pattern as courtstranscribe. Python backend (port 8000) and Next.js frontend (port 3001) coexist in one container behind Caddy (port 3000). Caddy routes `/api/*` and `/health` to Python; everything else to Next.js.
2. **Combined Dockerfile**: single image contains both backend and frontend, keeping the existing App Service deployment unchanged.
3. **Mock-only data**: `lib/mock-data.ts` provides realistic fixture data matching the screenshot design. Live API integration is a follow-up.
4. **DNS routing**: `/batch` is the Next.js basePath. Azure Front Door / App Gateway path-based routing to direct `courtstranscribe.*.platform.hmcts.net/batch` to this App Service is a separate infrastructure ticket.

## Follow-ups (documented on DIAAT-206)

- [ ] Wire up live API calls to the Python backend (`/api/v1/jobs`)
- [ ] Azure Front Door path routing so `/batch` is accessible under the courtstranscribe hostname
- [ ] Authentication (currently no auth on the frontend)

## Test plan

- [ ] `pnpm run type-check` — no errors
- [ ] `pnpm run test:unit` — all pass
- [ ] `pnpm run test:e2e` (with dev server running) — all pass
- [ ] `docker build` succeeds
- [ ] Dashboard page loads at `/batch`
- [ ] Transcript page loads at `/batch/jobs/job-pa05217-2025`
- [ ] Upload flow: select file → button enables → click → job appears in table

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Monitor CI and fix any failures**

```bash
gh pr checks --watch
```

For each failing check:
- `frontend-tests` fail → fix the test or the source code
- `frontend-analysis` fail → run `pnpm exec biome ci .` locally, fix issues with `pnpm run check`
- Python checks fail → those are pre-existing and should not have regressed; verify Dockerfile change didn't break Python imports

- [ ] **Step 5: Address Copilot review comments**

```bash
gh pr view --comments
```

For each Copilot suggestion:
- If it improves correctness or security: apply it
- If it is a stylistic preference that conflicts with the established Biome config: decline with a comment explaining the project standard
- After applying fixes: `git commit -m "fix: address Copilot review comments"`; `git push`

- [ ] **Step 6: Merge PR once all checks are green**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 7: Monitor deployment to dev**

The `deploy-dev.yml` workflow triggers on push to `main`. Watch it:

```bash
gh run watch $(gh run list --workflow=deploy-dev.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected: ADO infra pipeline runs Terraform + App Service image update.

- [ ] **Step 8: Run Playwright against dev URL**

Once the deployment completes, get the dev App Service URL:

```bash
# The App Service is hmcts-batch-transcription-dev — default URL:
DEV_URL="https://hmcts-batch-transcription-dev.azurewebsites.net"
cd frontend && PLAYWRIGHT_BASE_URL=$DEV_URL pnpm run test:e2e
```

Fix any failures (network timeouts, different page structure in production build vs dev server, etc.).

- [ ] **Step 9: Document decisions and follow-ups on DIAAT-206**

Post a comment on the Jira ticket with:
1. Link to the merged PR
2. Dev URL where the frontend is accessible
3. Architecture decisions made (from the PR description)
4. Follow-up items (live API, DNS routing, auth)

---

## Self-Review

**Spec coverage check:**
- ✅ Upload file button → `AudioUpload` component, dashboard page
- ✅ Transcription progress indicator → `Progress` + `JobStatusBadge`, simulated in `app/page.tsx`
- ✅ Link to created transcript → `JobsTable` "View transcript →" link
- ✅ Audio quality indicator → `TranscriptAccuracy` card (WER, confidence %)
- ✅ Links to previous transcripts → "Recent transcripts" section with `JobsTable`
- ✅ Links to previously uploaded audio → "All uploads" section in `JobsTable`
- ✅ Same tech stack as courtstranscribe → Next.js 16, React 19, pnpm 10, Tailwind CSS 4, Radix UI, Biome 2, Vitest 4
- ✅ Deployed via existing pipeline → Dockerfile updated, no new infrastructure needed
- ✅ Playwright E2E tests → Task 7 + Task 9
- ✅ Same DNS / different path → `basePath: '/batch'` + Caddyfile; full DNS routing is a follow-up

**No placeholders found.**
