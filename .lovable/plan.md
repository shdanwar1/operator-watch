The "Edit with Lovable" badge on the live site is a publish-level setting, not a component in the source code. I will hide it across all pages by toggling the project's badge visibility.

Plan
1. Set `publish_settings--set_badge_visibility` to `hide_badge: true`.
2. Verify the setting returns `hide_badge: true`.

Note: Hiding the badge requires a Pro plan or higher on Lovable. If the project is not on a qualifying plan, the tool will report that and the badge will remain visible.

No source files need to be changed for this request.