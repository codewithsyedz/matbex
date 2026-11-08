import { DynamicCMSPage } from "@/components/cms/DynamicCMSPage";
import { openCookieSettings } from "@/components/system/CookieConsentBanner";

/** Disclosure for ad measurement (Meta, Google) and lead attribution. */
function AdvertisingDisclosure() {
  return (
    <section id="advertising" className="mx-auto max-w-4xl px-6 pb-20">
      <h2 className="mb-3 text-2xl font-semibold">Advertising and measurement</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <p>
          When you book a demo, send an enquiry or start a free trial, we record which ad, campaign or website
          brought you to Matbex (for example the campaign name in the link and the ad click ID). We use this only to
          see which of our ads lead to real customers. It is stored with your request in our own systems.
        </p>
        <p>
          With your permission where the law requires it, our website also loads advertising tags from Meta
          (Facebook and Instagram) and Google. They tell those companies that a visit, sign-up or demo booking came
          from one of their ads, so we can measure and improve our advertising. Meta and Google receive your
          browser's technical details, their own cookie IDs and the type of action — not the contents of your form.
        </p>
        <p>
          Visitors in the European Economic Area, the UK and Switzerland are asked first, and nothing is loaded unless
          they accept. Elsewhere these tags run by default. A Global Privacy Control signal from your browser always
          turns them off. You can change your choice at any time.
        </p>
        <button type="button" onClick={openCookieSettings} className="text-primary underline-offset-2 hover:underline">
          Cookie settings
        </button>
      </div>
    </section>
  );
}

const PrivacyPolicy = () => {
  return (
    <DynamicCMSPage
      slug="privacy"
      seoTitle="Privacy Policy | Matbex Restaurant OS"
      seoDescription="Read how Matbex collects, stores, and protects restaurant operations data — sales, payroll, inventory, and team information — across our platform."
      afterContent={<AdvertisingDisclosure />}
    />
  );
};

export default PrivacyPolicy;
