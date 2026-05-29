import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Map from '@arcgis/core/Map';
import MapView from '@arcgis/core/views/MapView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import Search from '@arcgis/core/widgets/Search';
import Point from '@arcgis/core/geometry/Point';
import type { AdminFacility } from '../../types/facility';
import { getFieldSchema } from '../../utils/fieldSchemaCache';
import type { FieldDef } from '../../utils/fieldSchemaCache';
import { getFieldConfig, applyFieldConfig } from '../../utils/fieldConfig';
import HoursEditor from '../../components/admin/HoursEditor';
import styles from './AddFacilityModal.module.css';

const FEATURE_LAYER_URL =
  'https://services.arcgis.com/pDAi2YK0L0QxVJHj/arcgis/rest/services/Warming_and_Cooling_Centers/FeatureServer/0';
const REVERSE_GEOCODE_URL =
  'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onFacilityAdded: (facility: AdminFacility) => void;
  apiBase: string;
  idToken: string;
  triggerRef: React.RefObject<HTMLButtonElement>;
}

interface PinLocation {
  lat: number;
  lon: number;
}

function buildInitialFormValues(fields: FieldDef[]): Record<string, string> {
  const vals: Record<string, string> = {};
  for (const f of fields) vals[f.name] = '';
  return vals;
}

function isAddressField(f: FieldDef): boolean {
  return /address/i.test(f.name) || /address/i.test(f.alias);
}

export default function AddFacilityModal({
  isOpen,
  onClose,
  onFacilityAdded,
  apiBase,
  idToken,
  triggerRef,
}: Props) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MapView | null>(null);
  const graphicsLayerRef = useRef<GraphicsLayer | null>(null);
  const firstFormFieldRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  const [step, setStep] = useState<'map' | 'form'>('map');
  const [pin, setPin] = useState<PinLocation | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  // Open/close dialog
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) {
      setStep('map');
      setPin(null);
      setSaveError(null);
      setLiveAnnouncement('');
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [isOpen]);

  // Restore focus on close
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => triggerRef.current?.focus();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [triggerRef]);

  // Initialize MapView when modal is open on step 'map'
  useEffect(() => {
    if (!isOpen || step !== 'map') return;
    const container = mapContainerRef.current;
    if (!container || viewRef.current) return;

    const graphicsLayer = new GraphicsLayer();
    graphicsLayerRef.current = graphicsLayer;

    const map = new Map({ basemap: 'topo-vector', layers: [graphicsLayer] });
    const view = new MapView({
      container,
      map,
      center: [-96.0, 41.25],
      zoom: 11,
    });
    view.popupEnabled = false;
    viewRef.current = view;

    view.when(() => {
      const search = new Search({ view });
      view.ui.add(search, 'top-right');

      view.on('click', (evt) => {
        const pt = view.toMap(evt);
        if (!pt || pt.latitude == null || pt.longitude == null) return;
        const loc: PinLocation = { lat: pt.latitude, lon: pt.longitude };
        setPin(loc);

        graphicsLayer.removeAll();
        graphicsLayer.add(
          new Graphic({
            geometry: new Point({ longitude: pt.longitude, latitude: pt.latitude }),
            symbol: new SimpleMarkerSymbol({
              color: [21, 101, 192],
              outline: { color: [255, 255, 255], width: 2 },
              size: 12,
            }),
          }),
        );

        setLiveAnnouncement(t('admin.addFacility.pinPlaced', { lat: loc.lat.toFixed(5), lon: loc.lon.toFixed(5) }));
      });
    }).catch((err: unknown) => console.error('MapView init error:', err));

    return () => {
      view.destroy();
      viewRef.current = null;
      graphicsLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, step]);

  const handleConfirmLocation = useCallback(async () => {
    if (!pin) return;
    setSchemaError(null);

    try {
      const [schema, config] = await Promise.all([
        getFieldSchema(),
        getFieldConfig(apiBase, idToken),
      ]);
      const orderedFields = applyFieldConfig(schema, config);
      const initialValues = buildInitialFormValues(orderedFields);
      setFields(orderedFields);
      setFormValues(initialValues);
      setStep('form');

      // Move focus to first form field after transition
      requestAnimationFrame(() => firstFormFieldRef.current?.focus());

      // Reverse geocode
      try {
        const res = await fetch(
          `${REVERSE_GEOCODE_URL}?location=${pin.lon},${pin.lat}&f=json`,
        );
        const data = (await res.json()) as { result?: { address?: { Match_addr?: string } } };
        const addr = data.result?.address?.Match_addr;
        if (addr) {
          setFormValues((prev) => {
            const addrField = orderedFields.find(isAddressField);
            if (!addrField) return prev;
            return { ...prev, [addrField.name]: addr };
          });
        }
      } catch {
        setLiveAnnouncement(t('admin.addFacility.reverseGeocodeError'));
      }
    } catch {
      setSchemaError(t('admin.addFacility.schemaLoadError'));
    }
  }, [pin, apiBase, idToken, t]);

  const handleSave = useCallback(async () => {
    if (!pin) return;
    setIsSaving(true);
    setSaveError(null);

    const attributes: Record<string, string | number | null> = {};
    for (const f of fields) {
      const raw = formValues[f.name] ?? '';
      if (raw === '') {
        attributes[f.name] = null;
      } else if (
        f.type === 'esriFieldTypeInteger' ||
        f.type === 'esriFieldTypeSmallInteger' ||
        f.type === 'esriFieldTypeDouble' ||
        f.type === 'esriFieldTypeSingle'
      ) {
        attributes[f.name] = Number(raw);
      } else {
        attributes[f.name] = raw;
      }
    }

    try {
      const res = await fetch(`${apiBase}facility/add`, {
        method: 'POST',
        headers: { Authorization: idToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geometry: { x: pin.lon, y: pin.lat, spatialReference: { wkid: 4326 } },
          attributes,
        }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { newObjectId: number };

      // Fetch the new feature to pass back to parent
      const queryParams = new URLSearchParams({
        where: `ObjectID=${data.newObjectId}`,
        outFields: 'ObjectID,Name,Address,Warming_Active,Cooling_Active,EditDate',
        returnGeometry: 'false',
        f: 'json',
      });
      const featureRes = await fetch(`${FEATURE_LAYER_URL}/query?${queryParams.toString()}`);
      const featureData = (await featureRes.json()) as { features?: Array<{ attributes: AdminFacility }> };
      const newFacility = featureData.features?.[0]?.attributes;

      if (newFacility) onFacilityAdded(newFacility);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('admin.addFacility.saveError');
      setSaveError(t('admin.addFacility.saveError'));
      setLiveAnnouncement(msg);
      console.error('addFacility error:', err);
    } finally {
      setIsSaving(false);
    }
  }, [pin, fields, formValues, apiBase, idToken, onFacilityAdded, onClose, t]);

  const handleFieldChange = useCallback((name: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-modal="true"
      aria-labelledby="add-facility-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
    >
      {/* ARIA live region */}
      <div aria-live="assertive" aria-atomic="true" className={styles.srOnly}>
        {liveAnnouncement}
      </div>

      {/* Step 1 — Map */}
      <div className={`${styles.step} ${step === 'map' ? styles.stepActive : ''}`} aria-hidden={step !== 'map'}>
        <div className={styles.stepHeader}>
          <h2 id="add-facility-title" className={styles.title}>
            {t('admin.addFacility.step1Title')}
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label={t('admin.addFacility.cancel')}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <p className={styles.instruction}>{t('admin.addFacility.dropPinInstruction')}</p>

        <div
          ref={mapContainerRef}
          className={styles.mapContainer}
          aria-label={t('admin.addFacility.mapAriaLabel')}
        />

        {schemaError && (
          <p className={styles.errorMsg} role="alert">{schemaError}</p>
        )}

        {pin && (
          <p className={styles.coordsDisplay}>
            {t('admin.addFacility.coordsLabel', {
              lat: pin.lat.toFixed(5),
              lon: pin.lon.toFixed(5),
            })}
          </p>
        )}

        <div className={styles.stepActions}>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            {t('admin.addFacility.cancel')}
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={!pin}
            onClick={() => void handleConfirmLocation()}
          >
            {t('admin.addFacility.confirmLocation')}
          </button>
        </div>
      </div>

      {/* Step 2 — Form */}
      <div className={`${styles.step} ${step === 'form' ? styles.stepActive : ''}`} aria-hidden={step !== 'form'}>
        <div className={styles.stepHeader}>
          <h2 id="add-facility-title" className={styles.title}>
            {t('admin.addFacility.step2Title')}
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label={t('admin.addFacility.cancel')}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <button
          type="button"
          className={styles.backLink}
          onClick={() => setStep('map')}
        >
          {t('admin.addFacility.backToMap')}
        </button>

        <div className={styles.formScroll}>
          {fields.map((f, idx) => (
            <FieldInput
              key={f.name}
              field={f}
              value={formValues[f.name] ?? ''}
              onChange={handleFieldChange}
              inputRef={idx === 0 ? (el) => { firstFormFieldRef.current = el; } : undefined}
            />
          ))}
        </div>

        {saveError && (
          <p className={styles.errorMsg} role="alert" aria-live="assertive">
            {saveError}
          </p>
        )}

        <div className={styles.stepActions}>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            {t('admin.addFacility.discard')}
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={isSaving}
            onClick={() => void handleSave()}
          >
            {isSaving ? (
              <>
                <span className={styles.spinner} aria-hidden="true" />
                {t('admin.addFacility.saving')}
              </>
            ) : (
              t('admin.addFacility.save')
            )}
          </button>
        </div>
      </div>
    </dialog>
  );
}

interface FieldInputProps {
  field: FieldDef;
  value: string;
  onChange: (name: string, value: string) => void;
  inputRef?: (el: HTMLInputElement | HTMLSelectElement | null) => void;
}

function FieldInput({ field, value, onChange, inputRef }: FieldInputProps) {
  const required = field.nullable === false;
  const id = `field-${field.name}`;

  if (field.name === 'Hours') {
    return (
      <div className={styles.formGroup}>
        <label htmlFor={id} className={styles.fieldLabel}>
          {field.alias}
          {required && <span className={styles.required} aria-hidden="true"> *</span>}
        </label>
        <HoursEditor id={id} value={value} onChange={(v) => onChange(field.name, v)} required={required} />
      </div>
    );
  }

  if (field.domain?.type === 'codedValue' && field.domain.codedValues?.length) {
    return (
      <div className={styles.formGroup}>
        <label htmlFor={id} className={styles.fieldLabel}>
          {field.alias}
          {required && <span className={styles.required} aria-hidden="true"> *</span>}
        </label>
        <select
          id={id}
          className={styles.fieldInput}
          value={value}
          required={required}
          ref={inputRef as React.RefCallback<HTMLSelectElement>}
          onChange={(e) => onChange(field.name, e.target.value)}
        >
          <option value="" />
          {field.domain.codedValues.map((cv) => (
            <option key={String(cv.code)} value={String(cv.code)}>
              {cv.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  let type = 'text';
  let step: string | undefined;
  if (field.type === 'esriFieldTypeInteger' || field.type === 'esriFieldTypeSmallInteger') {
    type = 'number'; step = '1';
  } else if (field.type === 'esriFieldTypeDouble' || field.type === 'esriFieldTypeSingle') {
    type = 'number'; step = 'any';
  } else if (field.type === 'esriFieldTypeDate') {
    type = 'date';
  }

  return (
    <div className={styles.formGroup}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {field.alias}
        {required && <span className={styles.required} aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        type={type}
        step={step}
        className={styles.fieldInput}
        value={value}
        required={required}
        ref={inputRef as React.RefCallback<HTMLInputElement>}
        onChange={(e) => onChange(field.name, e.target.value)}
      />
    </div>
  );
}
