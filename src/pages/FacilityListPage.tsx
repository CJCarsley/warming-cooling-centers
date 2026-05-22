import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPublicArcGISToken } from '../utils/arcgisToken';
import styles from './FacilityListPage.module.css';

const FEATURE_LAYER_URL =
  'https://services.arcgis.com/pDAi2YK0L0QxVJHj/arcgis/rest/services/Warming_and_Cooling_Centers/FeatureServer/0';

interface ArcGISFeature {
  attributes: {
    ObjectID: number;
    Name: string;
    Address: string;
    Warming_Active: string;
    Cooling_Active: string;
    Hours: string;
    Phone: string;
    ADA_Compliant: string;
  };
}

interface ArcGISResponse {
  features?: ArcGISFeature[];
  error?: { message: string };
}

interface Facility {
  objectId: number;
  name: string;
  address: string;
  warmingActive: boolean;
  coolingActive: boolean;
  hours: string;
  phone: string;
  adaCompliant: string;
}

function TypeBadge({ warming, cooling }: { warming: boolean; cooling: boolean }) {
  const { t } = useTranslation();
  if (warming && cooling)
    return (
      <span className={`${styles.badge} ${styles.badgeDual}`}>
        {t('facilityList.typeBoth')}
      </span>
    );
  if (warming)
    return (
      <span className={`${styles.badge} ${styles.badgeWarming}`}>
        {t('facilityList.typeWarming')}
      </span>
    );
  if (cooling)
    return (
      <span className={`${styles.badge} ${styles.badgeCooling}`}>
        {t('facilityList.typeCooling')}
      </span>
    );
  return null;
}

export default function FacilityListPage() {
  const { t } = useTranslation();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getPublicArcGISToken()
      .then((token) => {
        const params = new URLSearchParams({
          where: "Warming_Active='Yes' OR Cooling_Active='Yes'",
          outFields: 'ObjectID,Name,Address,Warming_Active,Cooling_Active,Hours,Phone,ADA_Compliant',
          returnGeometry: 'false',
          orderByFields: 'Name ASC',
          f: 'json',
          token,
        });
        return fetch(`${FEATURE_LAYER_URL}/query?${params.toString()}`);
      })
      .then((res) => res.json() as Promise<ArcGISResponse>)
      .then((data) => {
        if (data.error) throw new Error(data.error.message);
        setFacilities(
          (data.features ?? []).map((f) => ({
            objectId: f.attributes.ObjectID,
            name: f.attributes.Name ?? '',
            address: f.attributes.Address ?? '',
            warmingActive: f.attributes.Warming_Active === 'Yes',
            coolingActive: f.attributes.Cooling_Active === 'Yes',
            hours: f.attributes.Hours ?? '',
            phone: f.attributes.Phone ?? '',
            adaCompliant: f.attributes.ADA_Compliant ?? '',
          })),
        );
      })
      .catch((err: unknown) => {
        console.error('FacilityListPage fetch error:', err);
        setError(t('common.error'));
      })
      .finally(() => setIsLoading(false));
  }, [t]);

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <h2 className={styles.heading}>{t('facilityList.heading')}</h2>
        <p className={styles.subheading}>{t('facilityList.subheading')}</p>

        {isLoading && (
          <div role="status" aria-live="polite" className={styles.loading}>
            {t('common.loading')}
          </div>
        )}

        {error && (
          <div role="alert" className={styles.errorMsg}>
            {error}
          </div>
        )}

        {!isLoading && !error && facilities.length === 0 && (
          <p className={styles.empty}>{t('facilityList.noActive')}</p>
        )}

        {!isLoading && !error && facilities.length > 0 && (
          <>
            <p className={styles.count} aria-live="polite">
              {t('facilityList.count', { count: facilities.length })}
            </p>
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <caption className={styles.srOnly}>
                  {t('facilityList.tableAriaLabel')}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('facility.name')}</th>
                    <th scope="col">{t('facility.address')}</th>
                    <th scope="col">{t('facilityList.colType')}</th>
                    <th scope="col">{t('facility.hours')}</th>
                    <th scope="col">{t('facility.phone')}</th>
                    <th scope="col">{t('facility.adaCompliant')}</th>
                  </tr>
                </thead>
                <tbody>
                  {facilities.map((f) => (
                    <tr key={f.objectId}>
                      <td className={styles.nameCell}>{f.name}</td>
                      <td>
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(f.address)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.addressLink}
                          aria-label={`${f.address} (${t('aria.externalLink')})`}
                        >
                          {f.address}
                        </a>
                      </td>
                      <td>
                        <TypeBadge warming={f.warmingActive} cooling={f.coolingActive} />
                      </td>
                      <td>
                        <span className={styles.mobileLabel} aria-hidden="true">
                          {t('facility.hours')}:{' '}
                        </span>
                        {f.hours || t('common.notAvailable')}
                      </td>
                      <td>
                        {f.phone ? (
                          <a href={`tel:${f.phone}`} className={styles.phoneLink}>
                            {f.phone}
                          </a>
                        ) : (
                          t('common.notAvailable')
                        )}
                      </td>
                      <td>
                        <span className={styles.mobileLabel} aria-hidden="true">
                          {t('facility.adaCompliant')}:{' '}
                        </span>
                        {f.adaCompliant || t('common.notAvailable')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
