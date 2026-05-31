/**
 * Stub GlobalAclPolicyService — governance ACL runtime was unshipped (PR #1045).
 * Provides a no-op service so the server can start.
 */

export class GlobalAclPolicyService {
  async load(): Promise<void> {
    // No-op — ACL governance unshipped
  }
}
