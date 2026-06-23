// Bundle PostHog's optional browser extensions with the application. Loading
// them later through injected <script> tags is commonly blocked by browser
// privacy tools, which breaks surveys, session replay, and exception capture.
export { default } from 'posthog-js/dist/module.full.no-external';

