import differenceBy from "lodash.differenceby";
import pagerduty from "../../pagerduty.app.mjs";
import common from "../common.mjs";
import { DEFAULT_POLLING_SOURCE_TIMER_INTERVAL } from "@pipedream/platform";

export default {
  ...common,
  key: "pagerduty-new-oncall-rotation",
  name: "New On-Call Rotation",
  version: "0.1.0",
  description: "Emit new event each time a new user rotates onto an on-call rotation",
  type: "source",
  props: {
    ...common.props,
    pagerduty,
    db: "$.service.db",
    escalationPoliciesIds: {
      type: "string[]",
      label: "Escalation Policies",
      description: "To filter your on-call rotations to specific escalation policies, select them here. **To listen for rotations across all escalation policies, leave this blank**.",
      propDefinition: [
        pagerduty,
        "escalationPolicyId",
      ],
    },
    timer: {
      type: "$.interface.timer",
      label: "Interval to poll for new rotations",
      description:
        "The PagerDuty API doesn't support webhook notifications for on-call rotations, so we must poll the API to check for these changes. Change this interval according to your needs.",
      default: {
        intervalSeconds: DEFAULT_POLLING_SOURCE_TIMER_INTERVAL,
      },
    },
  },
  async run() {
    // If the user didn't watch specific escalation policies,
    // iterate through all of the policies on the account
    const escalationPoliciesIds =
      this.escalationPoliciesIds?.length
        ? this.escalationPoliciesIds
        : await this.pagerduty.listEscalationPoliciesIds();

    // Since we can watch multiple escalation policies for rotations, we must
    // keep track of the last users who were on-call for a given policy.
    const oncallUsersByEscalationPolicy = this.getOncallUsersByEscalationPolicy() || {};

    for (const escalationPolicyId of escalationPoliciesIds) {
      // Multiple users can technically be on-call at the same time if the account
      // has multiple schedules attached to an escalation policy, so we must watch
      // for any new users in the list of on-call users who were not in the list of
      // users previously on-call. See
      // https://community.pagerduty.com/forum/t/how-do-i-add-more-than-one-person-on-call-for-a-schedule/751
      const oncallUsers = await this.pagerduty.listOncallUsers({
        params: {
          escalation_policy_ids: [
            escalationPolicyId,
          ],
        },
      });
      const previousUsersOncall = oncallUsersByEscalationPolicy[escalationPolicyId] || [];

      // Retrieve the list of users who were previously not on-call,
      // but now entered the rotation
      const newOncallUsers = differenceBy(
        oncallUsers,
        previousUsersOncall,
        "id",
      );

      oncallUsersByEscalationPolicy[escalationPolicyId] = oncallUsers;

      if (!newOncallUsers.length) {
        console.log(`No change to on-call users for escalation policy ${escalationPolicyId}`);
        continue;
      }

      // Include escalation policy metadata in emit
      const escalationPolicy =
        await this.pagerduty.getEscalationPolicy({
          escalationPolicyId,
        });

      newOncallUsers.forEach((user) => {
        this.$emit({
          user,
          escalationPolicy,
        }, {
          summary: `${user.summary} is now on-call for escalation policy ${escalationPolicy.name}`,
        });
      });
    }

    // Persist the new set of on-call users for the next run
    this.setOncallUsersByEscalationPolicy(oncallUsersByEscalationPolicy);
  },
};
