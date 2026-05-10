import type { LukeWorkflow } from "../../shared/types";

export const BUILT_IN_WORKFLOWS_PART_THREE: LukeWorkflow[] = [
  {
    id: "builtin-commercial-lease",
    user_id: null,
    is_system: true,
    created_at: "",
    title: "Commercial Lease Review",
    type: "tabular",
    practice: "Real Estate",
    prompt_md: null,
    columns_config: [
      {
        index: 0,
        name: "Landlord",
        format: "text",
        prompt:
          "Who is the landlord under this lease? State the full legal name, jurisdiction of incorporation or registration (if applicable), and any registered address or title number stated.",
      },
      {
        index: 1,
        name: "Tenant",
        format: "text",
        prompt:
          "Who is the tenant under this lease? State the full legal name, jurisdiction of incorporation or registration (if applicable), and any registered address stated.",
      },
      {
        index: 2,
        name: "Guarantor",
        format: "text",
        prompt:
          "Is there a guarantor under this lease? If so, state the guarantor's full legal name and the scope of the guarantee (e.g. full guarantee of the tenant's obligations, or limited to specific obligations). If there is no guarantor, state this explicitly.",
      },
      {
        index: 3,
        name: "Premises",
        format: "text",
        prompt:
          "Describe the premises demised under this lease. Include the address, floor(s), unit reference, net internal area (if stated), and any areas included or excluded from the demise (e.g. common parts, roof, structure, car parking).",
      },
      {
        index: 4,
        name: "Date of Lease",
        format: "date",
        prompt:
          "What is the date of this lease? If the lease is undated or if the term commencement date differs from the execution date, note both.",
      },
      {
        index: 5,
        name: "Term",
        format: "text",
        prompt:
          "What is the contractual term of this lease? State the length of the term and the term commencement and expiry dates.",
      },
      {
        index: 6,
        name: "Rent",
        format: "monetary_amount",
        prompt:
          "What is the initial annual rent payable under this lease? State the amount, the currency, the payment frequency (e.g. quarterly in advance), and the payment dates. Note any rent-free period or initial concessionary rent.",
      },
      {
        index: 7,
        name: "Rent Review",
        format: "text",
        prompt:
          "Are there rent review provisions? If so, state the review dates or frequency, the review mechanism (e.g. open market rent review, RPI/CPI indexation, fixed uplift), whether the review is upward-only, any assumptions and disregards applicable to an open market review, and the dispute resolution mechanism if the parties cannot agree the reviewed rent.",
      },
      {
        index: 8,
        name: "Service Charge",
        format: "text",
        prompt:
          "Is the tenant liable for a service charge? If so, describe what costs are included within the service charge, the tenant's apportionment or percentage share, any cap on the service charge, and how the service charge is administered and reconciled.",
      },
      {
        index: 9,
        name: "Insurance",
        format: "text",
        prompt:
          "What are the insurance obligations under this lease? State who insures (landlord or tenant), what risks must be insured, who bears the insurance premium cost, and the tenant's obligations in respect of the landlord's insurance (e.g. not to vitiate the policy, to pay the premium as additional rent).",
      },
      {
        index: 10,
        name: "Permitted Use",
        format: "text",
        prompt:
          "What is the permitted use of the premises under this lease? State the use class or specific use permitted and identify any restrictions on use. Note whether the landlord's consent is required to change use and on what basis consent may be withheld.",
      },
      {
        index: 11,
        name: "Repair & Maintenance",
        format: "text",
        prompt:
          "Who is responsible for repair and maintenance of the premises? Describe the extent of the tenant's repairing obligation (e.g. full repairing, internal repairing only, subject to a schedule of condition). State the landlord's repairing obligations, if any, in respect of the structure, exterior, or common parts.",
      },
      {
        index: 12,
        name: "Alterations",
        format: "text",
        prompt:
          "What alterations may the tenant make to the premises? Distinguish between structural and non-structural alterations. Is landlord consent required, and if so on what basis may it be withheld? Must the tenant reinstate alterations at the end of the term?",
      },
      {
        index: 13,
        name: "Assignment & Subletting",
        format: "text",
        prompt:
          "What rights does the tenant have to assign or sublet the premises? State whether assignment and subletting are permitted with landlord consent, on what grounds consent may be withheld, any conditions to be satisfied (e.g. an authorised guarantee agreement on assignment, rent at no less than the passing rent on subletting), and whether any dealings are prohibited outright.",
      },
      {
        index: 14,
        name: "Break Rights",
        format: "text",
        prompt:
          "Are there any break rights in this lease? If so, identify who holds the break right (landlord, tenant, or both), the break date(s), the notice period and form required to exercise the break, and any pre-conditions to effective exercise (e.g. no material breach, vacant possession, payment of all sums due).",
      },
      {
        index: 15,
        name: "Security of Tenure",
        format: "yes_no",
        prompt:
          "Does the tenant have statutory security of tenure (e.g. under the Landlord and Tenant Act 1954 in England and Wales, or equivalent legislation in another jurisdiction)? Answer Yes if the lease is contracted in or benefits from security of tenure. Answer No if the lease has been contracted out or if security of tenure does not apply. State the basis for your answer.",
      },
      {
        index: 16,
        name: "Dilapidations",
        format: "text",
        prompt:
          "What dilapidations obligations apply at the end of the term? Describe the tenant's yield-up obligations (e.g. to deliver the premises in repair, to reinstate alterations, to redecorate). Is there a schedule of condition limiting the tenant's liability? Note any dilapidations cap or other limitation on the landlord's claim.",
      },
      {
        index: 17,
        name: "Rent Deposit",
        format: "monetary_amount",
        prompt:
          "Is a rent deposit required? If so, state the amount, the period for which it is held, the conditions under which the landlord may draw on it, and the circumstances in which it is returned to the tenant.",
      },
      {
        index: 18,
        name: "Forfeiture & Termination",
        format: "text",
        prompt:
          "What are the landlord's forfeiture or termination rights? Identify the events that entitle the landlord to forfeit the lease (e.g. non-payment of rent after a grace period, material breach of covenant, insolvency) and any notice requirements before forfeiture can be exercised.",
      },
      {
        index: 19,
        name: "Governing Law",
        format: "text",
        prompt:
          "What governing law applies to this lease and which courts have jurisdiction over disputes?",
      },
    ],
  },

  // ─── Limited Partnership Agreement ───────────────────────────────────────────
  {
    id: "builtin-lpa",
    user_id: null,
    is_system: true,
    created_at: "",
    title: "Limited Partnership Agreement Review",
    type: "tabular",
    practice: "Private Equity",
    prompt_md: null,
    columns_config: [
      {
        index: 0,
        name: "General Partner",
        format: "text",
        prompt:
          "Identify the General Partner(s) of the fund. State the full legal name, jurisdiction of establishment, and any affiliated management entity (e.g. the fund manager or investment adviser) named in the agreement.",
      },
      {
        index: 1,
        name: "Fund Name & Jurisdiction",
        format: "text",
        prompt:
          "What is the full name of the fund and in which jurisdiction is the limited partnership established or registered?",
      },
      {
        index: 2,
        name: "Total Committed Capital",
        format: "monetary_amount",
        prompt:
          "What is the total committed capital of the fund? State the target size, any hard cap, the currency, and the closing date or dates if specified.",
      },
      {
        index: 3,
        name: "Capital Calls & Drawdowns",
        format: "text",
        prompt:
          "How and when may the GP call capital from LPs? State the notice period for capital calls, the mechanics for issuing a call notice, any limit on the frequency or size of calls, and whether undrawn commitments can be recalled after repayment.",
      },
      {
        index: 4,
        name: "Penalties for Failure to Fund",
        format: "text",
        prompt:
          "What are the consequences if an LP fails to fund a capital call? Describe any penalties (e.g. interest on the shortfall, dilution of interest, forced transfer at a discount, loss of voting or distribution rights, exclusion from future investments). Are there any cure periods before penalties apply?",
      },
      {
        index: 5,
        name: "Investment Scope & Restrictions",
        format: "text",
        prompt:
          "What is the fund's stated investment strategy, scope, and any restrictions? Include permitted sectors, geographies, investment stages, instrument types, and any concentration limits (e.g. maximum % of committed capital per single investment). Note how much discretion the GP has to deviate from the stated strategy.",
      },
      {
        index: 6,
        name: "Fund Term",
        format: "text",
        prompt:
          "What is the term of the fund? State the initial term (e.g. 10 years from final closing), any permitted extension periods (e.g. 2 × 1-year extensions), who has the right to approve extensions (GP alone or with LP/LPAC consent), and any early termination mechanics.",
      },
      {
        index: 7,
        name: "Management Fee",
        format: "text",
        prompt:
          "What management fee is payable to the GP or manager? State the fee rate, the basis on which it is calculated (e.g. committed capital during the investment period, then invested or net asset value thereafter), any step-downs over the fund life, and the payment frequency.",
      },
      {
        index: 8,
        name: "Carried Interest",
        format: "text",
        prompt:
          "What carried interest (carry) is payable to the GP? State the carry percentage, the structure (European/fund-level waterfall vs American/deal-by-deal), and identify each step of the distribution waterfall in sequence (e.g. return of capital, preferred return, GP catch-up, then profit split).",
      },
      {
        index: 9,
        name: "Preferred Return (Hurdle Rate)",
        format: "percentage",
        prompt:
          "Is there a preferred return or hurdle rate that LPs must receive before the GP earns carry? State the rate, whether it is compounded (and on what basis), and how it is calculated (e.g. on invested capital, on contributed capital). If there is no preferred return, state this explicitly.",
      },
      {
        index: 10,
        name: "GP Catch-Up",
        format: "text",
        prompt:
          "Is there a GP catch-up mechanism after the preferred return is met? If so, describe how it operates: what percentage of distributions go to the GP during the catch-up, and what economic result the catch-up is designed to achieve (e.g. the GP receives 20% of all profits to date).",
      },
      {
        index: 11,
        name: "Clawback",
        format: "text",
        prompt:
          "Is there a clawback obligation on the GP if it receives excess carry? State whether the clawback is calculated at fund level or individual partner level, when it is triggered, any cap or limit on the clawback obligation, and whether there is any escrow or security arrangement to support the GP's clawback obligation.",
      },
      {
        index: 12,
        name: "Fees & Expenses (Beyond Management Fee)",
        format: "bulleted_list",
        prompt:
          "What fees and expenses are charged to the fund or LPs beyond the management fee? List each category (e.g. transaction fees, monitoring fees, broken deal costs, formation expenses, legal fees, fund administration costs, organisational expenses). For each, state who bears the cost and whether any amounts are offset against the management fee.",
      },
      {
        index: 13,
        name: "Distributions",
        format: "text",
        prompt:
          "How and when are distributions made to LPs? Describe the timing of distributions (e.g. upon realisation of investments or at the GP's discretion), whether the GP can reinvest proceeds within the investment period, and whether distributions may be made in-kind (i.e. as securities rather than cash).",
      },
      {
        index: 14,
        name: "Key Person Clause",
        format: "text",
        prompt:
          "Is there a key person clause? Identify the designated key persons. What triggers the key person event (e.g. departure, incapacity, reduced time commitment below a threshold)? What are the consequences (e.g. suspension of the investment period)? Do LPs have any right to terminate or vote on continuation following a key person event?",
      },
      {
        index: 15,
        name: "Removal of the GP",
        format: "text",
        prompt:
          "Under what circumstances can the GP be removed? Distinguish between removal for cause (e.g. fraud, gross negligence, wilful misconduct — state the LP voting threshold required) and removal without cause (state the LP voting threshold and any associated consequences such as carried interest treatment on removal).",
      },
      {
        index: 16,
        name: "Advisory Committee (LPAC)",
        format: "text",
        prompt:
          "Is there an LP Advisory Committee (LPAC) or similar governance body? If so, describe its composition, how members are selected, its key powers and responsibilities (e.g. approving conflicts of interest, valuations, extensions, related-party transactions), and whether its approval is binding or merely advisory.",
      },
      {
        index: 17,
        name: "Transfer Restrictions",
        format: "text",
        prompt:
          "What restrictions apply to an LP transferring or assigning its interest in the fund? Is GP consent required? Are there any permitted transfer exceptions (e.g. to affiliates)? Are secondary market sales permitted and, if so, subject to what conditions or rights of first refusal?",
      },
      {
        index: 18,
        name: "Conflicts of Interest",
        format: "text",
        prompt:
          "How does the agreement address conflicts of interest? Describe the deal allocation policy across funds, any co-investment rights granted to LPs, restrictions on related-party transactions, and the role of the LPAC in reviewing or approving conflicts. Note any specific conflict scenarios expressly contemplated.",
      },
      {
        index: 19,
        name: "Governing Law",
        format: "text",
        prompt:
          "What governing law applies to this agreement and which courts or arbitral tribunals have jurisdiction over disputes?",
      },
    ],
  },

  // ─── Shareholder Agreement (Assistant) ───────────────────────────────────────
  {
    id: "builtin-sha-summary",
    user_id: null,
    is_system: true,
    created_at: "",
    title: "Shareholder Agreement Summary",
    type: "assistant",
    practice: "Corporate",
    prompt_md:
      "## Shareholder Agreement Summary\n\n" +
      "Review the uploaded shareholder agreement and produce a comprehensive legal summary covering the following topics. " +
      "For each section, identify the key provisions, quote the relevant clause references, and flag any unusual, onerous, or market-standard deviations.\n\n" +
      "1. **Parties & Shareholdings** — Full legal names, roles, share classes held, and percentage interests (on a fully diluted basis if stated)\n" +
      "2. **Share Classes & Rights** — For each class: voting rights, dividend rights, liquidation preference, conversion or redemption features\n" +
      "3. **Board Composition & Governance** — Board size, director appointment rights (and the shareholding thresholds required to maintain them), quorum, and casting vote\n" +
      "4. **Reserved Matters** — Decisions requiring a special majority, unanimity, or a specific shareholder's consent; note the threshold and whose consent is required for each\n" +
      "5. **Pre-emption on New Shares** — Who holds pre-emption rights, procedure, timeline, and any carve-outs (e.g. employee option schemes)\n" +
      "6. **Transfer Restrictions** — Lock-up periods, prohibited transfers, permitted transfers (e.g. to affiliates), and any board or shareholder approval requirements\n" +
      "7. **Right of First Refusal / Pre-emption on Transfer** — Trigger, procedure, pricing mechanics, and any exceptions\n" +
      "8. **Drag-Along Rights** — Who holds the right, threshold to trigger, conditions (e.g. minimum price, independent valuation), and minority protections\n" +
      "9. **Tag-Along Rights** — Who holds the right, triggering threshold, exercise procedure, and price terms\n" +
      "10. **Anti-Dilution Protections** — Type (full ratchet, weighted average), trigger events, calculation mechanics, and exceptions\n" +
      "11. **Dividend Policy** — Any obligation or target to pay dividends, preferential dividend rights, and restrictions on distributions\n" +
      "12. **Exit & Liquidity** — Agreed exit routes (trade sale, IPO, drag sale), timelines, and liquidation preferences on exit\n" +
      "13. **Deadlock** — Deadlock definition, escalation and resolution mechanisms (e.g. Russian roulette, put/call options), and consequences if unresolved\n" +
      "14. **Non-Compete & Non-Solicitation** — Who is bound, scope of activities and geography, duration, and carve-outs\n" +
      "15. **Governing Law & Dispute Resolution** — Applicable law, forum, arbitration or litigation, and any mandatory escalation steps\n\n" +
      "Generate the summary as a downloadable Word document.",
    columns_config: null,
  },

  // ─── Shareholder Agreement ────────────────────────────────────────────────────
];
